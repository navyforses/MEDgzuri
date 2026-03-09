/**
 * MedGzuri Research Alerts API
 *
 * კვლევის შეტყობინებების მართვა:
 *   - create: ახალი შეტყობინების შექმნა (ავტომატური კვლევის მონიტორინგი)
 *   - list:   შეტყობინებების სიის მიღება
 *   - delete: შეტყობინების წაშლა
 *
 * Railway FastAPI backend → Supabase fallback
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, createRateLimiter,
    getClientIp, sanitizeString
} = require('../lib/security');
const { authenticateUser } = require('../lib/auth');
const { tryRailway: tryRailwayProxy } = require('../lib/railway');

const alertsRateLimiter = createRateLimiter(10, 60 * 1000); // 10 req/min

// ═══════════════ RAILWAY ACTION MAP ═══════════════

const ALERTS_ACTIONS = {
    create: { method: 'POST', buildUrl: (base) => base },
    list:   { method: 'GET',  buildUrl: (base) => base, hasBody: false },
    delete: { method: 'DELETE', buildUrl: (base, p) => `${base}/${p.id}`, hasBody: false },
};

function tryRailway(action, token, payload) {
    return tryRailwayProxy('/api/alerts', ALERTS_ACTIONS, action, token, payload, 'alerts');
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
    if (alertsRateLimiter(clientIp)) {
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
            case 'create': {
                const { query, searchType, frequency } = payload;

                if (!query) {
                    return res.status(400).json({ error: 'საძიებო ტერმინი სავალდებულოა.' });
                }

                const validFrequencies = ['daily', 'weekly', 'monthly'];
                const freq = validFrequencies.includes(frequency) ? frequency : 'weekly';
                const validTypes = ['research', 'symptoms', 'clinics'];
                const type = validTypes.includes(searchType) ? searchType : 'research';

                // Try Railway first
                const railwayResult = await tryRailway('create', token, {
                    query: sanitizeString(query, 500),
                    search_type: type,
                    frequency: freq
                });
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const { data, error } = await supabase
                    .from('research_alerts')
                    .insert({
                        user_id: user.id,
                        query: sanitizeString(query, 500),
                        search_type: type,
                        frequency: freq,
                        is_active: true,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) {
                    console.error('[MedGzuri] Alert create error:', error.message);
                    return res.status(500).json({ error: 'შეტყობინების შექმნა ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, alert: data });
            }

            case 'list': {
                // Try Railway first
                const railwayResult = await tryRailway('list', token, null);
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const { data: alerts, error } = await supabase
                    .from('research_alerts')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('[MedGzuri] Alert list error:', error.message);
                    return res.status(500).json({ error: 'შეტყობინებების მიღება ვერ მოხერხდა.' });
                }

                return res.status(200).json({ alerts: alerts || [] });
            }

            case 'delete': {
                const { id } = payload;
                if (!id) {
                    return res.status(400).json({ error: 'შეტყობინების ID სავალდებულოა.' });
                }

                // Try Railway first
                const railwayResult = await tryRailway('delete', token, { id });
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase (ensure user owns the alert)
                const { error } = await supabase
                    .from('research_alerts')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) {
                    console.error('[MedGzuri] Alert delete error:', error.message);
                    return res.status(500).json({ error: 'შეტყობინების წაშლა ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, message: 'შეტყობინება წაიშალა.' });
            }

            default:
                return res.status(400).json({ error: 'უცნობი მოქმედება. მხარდაჭერილია: create, list, delete' });
        }
    } catch (err) {
        console.error('[MedGzuri] Alerts error:', err);
        return res.status(500).json({ error: 'სერვერის შეცდომა. გთხოვთ სცადოთ მოგვიანებით.' });
    }
};
