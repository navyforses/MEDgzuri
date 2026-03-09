/**
 * MedGzuri Analytics API (Admin Only)
 *
 * Endpoints (via action field):
 *   GET /api/analytics (dashboard)  — full analytics dashboard
 *   GET /api/analytics (searches)   — popular searches
 *
 * Requires authentication. Admin role check is TODO.
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, authRateLimiter, getClientIp
} = require('../lib/security');

const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;

module.exports = async function handler(req, res) {
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientIp = getClientIp(req);
    if (authRateLimiter(clientIp)) {
        return res.status(429).json({ error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.' });
    }

    // Auth required
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    // TODO: Add admin role check when role system is implemented

    const view = req.query?.view || 'dashboard';

    try {
        if (view === 'searches') {
            return await handlePopularSearches(req, res);
        }
        if (view === 'geographic') {
            return await handleGeographic(req, res);
        }
        return await handleDashboard(req, res);
    } catch (e) {
        console.error('[Analytics]', e.message || e);
        return res.status(500).json({ error: 'ანალიტიკა ვერ ჩაიტვირთა.' });
    }
};


// ═══════════════ DASHBOARD ═══════════════

async function handleDashboard(req, res) {
    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/analytics/dashboard`, {
                headers: { 'Authorization': req.headers.authorization || '' },
            });
            if (resp.ok) {
                return res.status(200).json(await resp.json());
            }
        } catch (e) {
            // Fallback
        }
    }

    // Fallback: empty dashboard
    return res.status(200).json({
        period: 'month',
        searches_today: 0,
        searches_week: 0,
        searches_month: 0,
        unique_users_month: 0,
        tier_distribution: {},
        searches_by_type: {},
        conversions_month: 0,
        generated_at: new Date().toISOString(),
        note: 'Railway backend unavailable — showing stub data.',
    });
}


// ═══════════════ POPULAR SEARCHES ═══════════════

async function handlePopularSearches(req, res) {
    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/analytics/searches`, {
                headers: { 'Authorization': req.headers.authorization || '' },
            });
            if (resp.ok) {
                return res.status(200).json(await resp.json());
            }
        } catch (e) {
            // Fallback
        }
    }

    return res.status(200).json({
        items: [],
        note: 'Railway backend unavailable — showing stub data.',
    });
}


// ═══════════════ GEOGRAPHIC ═══════════════

async function handleGeographic(req, res) {
    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/analytics/geographic`, {
                headers: { 'Authorization': req.headers.authorization || '' },
            });
            if (resp.ok) {
                return res.status(200).json(await resp.json());
            }
        } catch (e) {
            // Fallback
        }
    }

    return res.status(200).json({
        period_days: 30,
        countries: {},
        note: 'Railway backend unavailable — showing stub data.',
    });
}


// ═══════════════ HELPERS ═══════════════

async function getUserId(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;

    const supabase = getServiceClient();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
        if (error || !data?.user) return null;
        return data.user.id;
    } catch {
        return null;
    }
}
