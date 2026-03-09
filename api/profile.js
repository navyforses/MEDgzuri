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
const { authenticateUser } = require('../lib/auth');
const { tryRailway: tryRailwayProxy } = require('../lib/railway');

const profileRateLimiter = createRateLimiter(10, 60 * 1000); // 10 req/min

// ═══════════════ RAILWAY ACTION MAP ═══════════════

const PROFILE_ACTIONS = {
    get:    { method: 'GET', buildUrl: (base) => base, hasBody: false },
    update: { method: 'PUT', buildUrl: (base) => base },
};

function tryRailway(action, token, payload) {
    return tryRailwayProxy('/api/profile', PROFILE_ACTIONS, action, token, payload, 'profile');
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
