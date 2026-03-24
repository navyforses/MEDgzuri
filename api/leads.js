/**
 * MedGzuri Leads API
 *
 * Actions:
 *   - create:  Submit new lead (contact form, public) — supports multipart with file uploads
 *   - list:    Get all leads (admin/operator only)
 *   - update:  Update lead status/notes (admin/operator only)
 *   - stats:   Lead analytics (admin only)
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, leadsRateLimiter,
    getClientIp, sanitizeString, isValidEmail, isValidPhone
} = require('../lib/security');
const { uploadLeadDocuments } = require('../lib/google-drive');

// Vercel serverless: disable default body parser for multipart
module.exports.config = {
    api: { bodyParser: false }
};

// ═══════════════ MULTIPART PARSER ═══════════════

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB per file
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total

/**
 * Parse multipart/form-data request using busboy.
 * Returns { fields: { data: string }, files: [{ name, buffer, mimeType }] }
 */
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const Busboy = require('busboy');
        const busboy = Busboy({
            headers: req.headers,
            limits: { fileSize: MAX_FILE_SIZE, files: 10 }
        });

        const fields = {};
        const files = [];
        let totalSize = 0;

        busboy.on('field', (name, val) => {
            fields[name] = val;
        });

        busboy.on('file', (fieldname, stream, info) => {
            const { filename, mimeType } = info;
            const chunks = [];

            stream.on('data', (chunk) => {
                totalSize += chunk.length;
                if (totalSize > MAX_TOTAL_SIZE) {
                    stream.destroy();
                    reject(new Error('Total upload size exceeds 100MB'));
                    return;
                }
                chunks.push(chunk);
            });

            stream.on('end', () => {
                if (filename) {
                    files.push({
                        name: filename,
                        buffer: Buffer.concat(chunks),
                        mimeType: mimeType || 'application/octet-stream'
                    });
                }
            });
        });

        busboy.on('finish', () => resolve({ fields, files }));
        busboy.on('error', reject);

        req.pipe(busboy);
    });
}

// ═══════════════ MAIN HANDLER ═══════════════

module.exports = async function handler(req, res) {
    // CORS & security headers (shared)
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return; // OPTIONS handled

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Rate limiting
    const clientIp = getClientIp(req);
    if (leadsRateLimiter(clientIp)) {
        return res.status(429).json({ error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.' });
    }

    // ── Parse request body (JSON or multipart) ──
    let action, payload, uploadFiles = [];
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
        // Multipart: intake form with file uploads
        const { fields, files } = await parseMultipart(req);
        const parsed = JSON.parse(fields.data || '{}');
        action = parsed.action;
        payload = parsed;
        delete payload.action;
        uploadFiles = files;
    } else {
        // Standard JSON — manually parse since bodyParser is disabled
        let body = req.body;
        if (!body || typeof body !== 'object') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString('utf8');
            body = raw ? JSON.parse(raw) : {};
        }
        action = body.action;
        payload = { ...body };
        delete payload.action;
    }

    const supabase = getServiceClient();

    // ── Public: Create lead (no auth required) ──
    if (action === 'create') {
        const { name, phone, email, message, source } = payload;
        if (!name || (!phone && !email)) {
            return res.status(400).json({ error: 'სახელი და საკონტაქტო ინფორმაცია სავალდებულოა.' });
        }
        if (email && !isValidEmail(email)) {
            return res.status(400).json({ error: 'ელ-ფოსტის ფორმატი არასწორია.' });
        }
        if (phone && !isValidPhone(phone)) {
            return res.status(400).json({ error: 'ტელეფონის ნომრის ფორმატი არასწორია.' });
        }

        // ── Upload documents to Google Drive ──
        let documentLinks = [];
        let driveWarning = null;
        console.log('[MedGzuri] Drive diagnostics:', {
            filesReceived: uploadFiles.length,
            fileSizes: uploadFiles.map(f => `${f.name}(${f.buffer?.length || 0}b)`),
            hasServiceAccount: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
            hasFolderId: !!process.env.GOOGLE_DRIVE_FOLDER_ID,
            contentType: req.headers['content-type']?.substring(0, 50)
        });
        if (uploadFiles.length > 0) {
            if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
                driveWarning = 'GOOGLE_SERVICE_ACCOUNT_JSON not configured';
                console.warn('[MedGzuri] Drive upload skipped: GOOGLE_SERVICE_ACCOUNT_JSON (or _KEY) not set');
            } else if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
                driveWarning = 'GOOGLE_DRIVE_FOLDER_ID not configured';
                console.warn('[MedGzuri] Drive upload skipped: GOOGLE_DRIVE_FOLDER_ID not set');
            } else {
                try {
                    console.log('[MedGzuri] Uploading', uploadFiles.length, 'file(s) to Drive for lead:', name);
                    const driveResults = await uploadLeadDocuments(uploadFiles, name);
                    documentLinks = driveResults.map(f => ({
                        name: f.name,
                        url: f.webViewLink,
                        driveId: f.id
                    }));
                    console.log('[MedGzuri] Drive upload success:', documentLinks.length, 'file(s)');
                } catch (driveErr) {
                    driveWarning = driveErr.message;
                    console.error('[MedGzuri] Google Drive upload error:', driveErr.message, driveErr.stack);
                    // Continue without files — don't block lead submission
                }
            }
        } else if (uploadFiles.length === 0 && (req.headers['content-type'] || '').includes('multipart')) {
            console.warn('[MedGzuri] Multipart request received but no files parsed — possible bodyParser conflict');
        }

        // Enrich message with document links if any
        let enrichedMessage = message || null;
        if (documentLinks.length > 0 && enrichedMessage) {
            try {
                const msgData = JSON.parse(enrichedMessage);
                msgData.documents = documentLinks;
                enrichedMessage = JSON.stringify(msgData);
            } catch {
                // message is plain text, append links
                enrichedMessage += '\n\nDocuments: ' + documentLinks.map(d => d.url).join(', ');
            }
        }

        if (!supabase) {
            // Fallback: return success but note data isn't persisted
            console.log('[MedGzuri] Lead received (no DB):', { name, email, phone, documents: documentLinks.length });
            return res.status(200).json({
                success: true,
                message: 'თქვენი მოთხოვნა მიღებულია. დაგიკავშირდებით მალე!',
                persisted: false,
                documentsUploaded: documentLinks.length,
                ...(driveWarning && { driveWarning })
            });
        }

        try {
            const insertData = {
                name,
                phone: phone || null,
                email: email || null,
                message: enrichedMessage,
                source: source || 'website',
                status: 'new'
            };

            // Store Drive folder link if documents were uploaded
            if (documentLinks.length > 0) {
                insertData.documents_url = documentLinks[0].url.replace(/\/file\/.*/, '');
            }

            const { error } = await supabase.from('leads').insert(insertData);

            if (error) {
                console.error('[MedGzuri] Lead insert error:', error.message);
                return res.status(500).json({ error: 'მოთხოვნის შენახვა ვერ მოხერხდა.' });
            }

            return res.status(200).json({
                success: true,
                message: 'თქვენი მოთხოვნა მიღებულია. დაგიკავშირდებით მალე!',
                persisted: true,
                documentsUploaded: documentLinks.length,
                ...(driveWarning && { driveWarning })
            });
        } catch (err) {
            console.error('[MedGzuri] Lead error:', err);
            return res.status(500).json({ error: 'სერვერის შეცდომა.' });
        }
    }

    // ── Protected endpoints (require auth) ──
    if (!supabase) {
        return res.status(503).json({ error: 'სერვისი არ არის კონფიგურირებული.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'ავტორიზაცია საჭიროა.' });
    }
    const token = authHeader.split(' ')[1];

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
        return res.status(401).json({ error: 'არასწორი ან ვადაგასული ტოკენი.' });
    }

    // Check role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || !['admin', 'operator'].includes(profile.role)) {
        return res.status(403).json({ error: 'არასაკმარისი უფლებები.' });
    }

    try {
        switch (action) {
            case 'list': {
                const { status, limit = 50, offset = 0 } = payload;
                let query = supabase
                    .from('leads')
                    .select('*', { count: 'exact' })
                    .order('created_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (status) query = query.eq('status', status);

                const { data, error, count } = await query;
                if (error) throw error;

                return res.status(200).json({ leads: data, total: count });
            }

            case 'update': {
                const { id, status, notes, assigned_to } = payload;
                if (!id) return res.status(400).json({ error: 'Lead ID სავალდებულოა.' });

                const updates = {};
                if (status) updates.status = status;
                if (notes !== undefined) updates.notes = notes;
                if (assigned_to !== undefined) updates.assigned_to = assigned_to;

                const { error } = await supabase
                    .from('leads')
                    .update(updates)
                    .eq('id', id);

                if (error) throw error;
                return res.status(200).json({ success: true });
            }

            case 'stats': {
                if (profile.role !== 'admin') {
                    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორისთვის.' });
                }

                const { data: statusCounts } = await supabase
                    .rpc('lead_stats_by_status');

                const { count: totalToday } = await supabase
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

                const { count: totalWeek } = await supabase
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

                return res.status(200).json({
                    byStatus: statusCounts || [],
                    today: totalToday || 0,
                    thisWeek: totalWeek || 0
                });
            }

            default:
                return res.status(400).json({ error: 'უცნობი მოქმედება.' });
        }
    } catch (err) {
        console.error('[MedGzuri] Leads API error:', err);
        return res.status(500).json({ error: 'სერვერის შეცდომა.' });
    }
};
