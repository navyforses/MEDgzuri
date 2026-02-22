/**
 * MedGzuri Leads API
 *
 * Actions:
 *   - create:  Submit new lead (contact form, public)
 *   - list:    Get all leads (admin/operator only)
 *   - update:  Update lead status/notes (admin/operator only)
 *   - stats:   Lead analytics (admin only)
 */

const { getServiceClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
    // CORS
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['*'];
    const origin = req.headers.origin || '*';
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, ...payload } = req.body || {};
    const supabase = getServiceClient();

    // ── Public: Create lead (no auth required) ──
    if (action === 'create') {
        const { name, phone, email, message, source } = payload;
        if (!name || (!phone && !email)) {
            return res.status(400).json({ error: 'სახელი და საკონტაქტო ინფორმაცია სავალდებულოა.' });
        }

        if (!supabase) {
            // Fallback: return success but note data isn't persisted
            console.log('[MedGzuri] Lead received (no DB):', { name, email, phone });
            return res.status(200).json({
                success: true,
                message: 'თქვენი მოთხოვნა მიღებულია. დაგიკავშირდებით მალე!',
                persisted: false
            });
        }

        try {
            const { error } = await supabase.from('leads').insert({
                name,
                phone: phone || null,
                email: email || null,
                message: message || null,
                source: source || 'website',
                status: 'new'
            });

            if (error) {
                console.error('[MedGzuri] Lead insert error:', error.message);
                return res.status(500).json({ error: 'მოთხოვნის შენახვა ვერ მოხერხდა.' });
            }

            return res.status(200).json({
                success: true,
                message: 'თქვენი მოთხოვნა მიღებულია. დაგიკავშირდებით მალე!',
                persisted: true
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
