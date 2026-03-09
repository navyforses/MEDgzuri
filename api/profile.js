/**
 * MedGzuri Profile API
 *
 * მომხმარებლის პროფილის მართვა:
 *   - get:    პროფილის მონაცემების მიღება
 *   - update: პროფილის განახლება
 *
 * Railway FastAPI backend → Supabase fallback
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, createRateLimiter,
    getClientIp, sanitizeString
} = require('../lib/security');

const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;

const profileRateLimiter = createRateLimiter(10, 60 * 1000); // 10 req/min

// ═══════════════ AUTH HELPER ═══════════════

async function authenticateUser(req, supabase) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return { user: null, token: null, error: 'ავტორიზაცია საჭიროა.' };
    }
    const token = authHeader.split(' ')[1];

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return { user: null, token: null, error: 'არასწორი ან ვადაგასული ტოკენი.' };
    }
    return { user, token, error: null };
}

// ═══════════════ RAILWAY PROXY ═══════════════

async function tryRailway(action, token, payload) {
    if (!RAILWAY_BACKEND_URL) return null;

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        let url, method, body;

        if (action === 'get') {
            url = `${RAILWAY_BACKEND_URL}/api/profile`;
            method = 'GET';
        } else if (action === 'update') {
            url = `${RAILWAY_BACKEND_URL}/api/profile`;
            method = 'PUT';
            body = JSON.stringify(payload);
        }

        const resp = await fetch(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(10000)
        });

        if (!resp.ok) return null;
        return await resp.json();
    } catch (err) {
        console.warn('[MedGzuri] Railway profile proxy failed:', err.message);
        return null;
    }
}

// ═══════════════ HANDLER ═══════════════

module.exports = async function handler(req, res) {
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting
    const clientIp = getClientIp(req);
    if (profileRateLimiter(clientIp)) {
        return res.status(429).json({ error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.' });
    }

    const supabase = getServiceClient();
    if (!supabase) {
        return res.status(503).json({
            error: 'სერვისი არ არის კონფიგურირებული.',
            fallback: true
        });
    }

    const { action, ...payload } = req.body || {};

    // Authenticate
    const { user, token, error: authError } = await authenticateUser(req, supabase);
    if (authError) {
        return res.status(401).json({ error: authError });
    }

    try {
        switch (action) {
            case 'get': {
                // Try Railway first
                const railwayResult = await tryRailway('get', token, null);
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                if (error) {
                    console.error('[MedGzuri] Profile get error:', error.message);
                    return res.status(500).json({ error: 'პროფილის მიღება ვერ მოხერხდა.' });
                }

                return res.status(200).json({
                    profile: { ...profile, email: user.email }
                });
            }

            case 'update': {
                const { fullName, phone, preferences } = payload;

                // Try Railway first
                const railwayResult = await tryRailway('update', token, { fullName, phone, preferences });
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const updates = {};
                if (fullName !== undefined) updates.full_name = sanitizeString(fullName, 200);
                if (phone !== undefined) updates.phone = sanitizeString(phone, 20);
                if (preferences !== undefined) updates.preferences = preferences;
                updates.updated_at = new Date().toISOString();

                const { error } = await supabase
                    .from('profiles')
                    .update(updates)
                    .eq('id', user.id);

                if (error) {
                    console.error('[MedGzuri] Profile update error:', error.message);
                    return res.status(500).json({ error: 'პროფილის განახლება ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, message: 'პროფილი განახლდა.' });
            }

            default:
                return res.status(400).json({ error: 'უცნობი მოქმედება. მხარდაჭერილია: get, update' });
        }
    } catch (err) {
        console.error('[MedGzuri] Profile error:', err);
        return res.status(500).json({ error: 'სერვერის შეცდომა. გთხოვთ სცადოთ მოგვიანებით.' });
    }
};
