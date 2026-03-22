/**
 * MedGzuri Subscription API
 *
 * Endpoints (via action field or HTTP method):
 *   GET  /api/subscription           — get current subscription + tier info
 *   POST /api/subscription (upgrade) — initiate subscription upgrade (STUB)
 *   POST /api/subscription (usage)   — get usage stats
 *
 * Payment integration is STUB — ready for Stripe or Bank of Georgia (BOG).
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, authRateLimiter, getClientIp
} = require('../lib/security');

// ═══════════════ CONFIG ═══════════════

const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;

// ═══════════════ TIER DEFINITIONS ═══════════════

const TIERS = {
    free: {
        name: 'უფასო',
        name_en: 'Free',
        price_gel: 0,
        daily_search_limit: 5,
        features: ['basic_search'],
    },
    pro: {
        name: 'პრო',
        name_en: 'Pro',
        price_gel: 15,
        daily_search_limit: -1,
        features: ['basic_search', 'evidence_grading', 'price_comparison', 'alerts', 'search_history', 'bookmarks'],
    },
    doctor: {
        name: 'ექიმი',
        name_en: 'Doctor',
        price_gel: 30,
        daily_search_limit: -1,
        features: [
            'basic_search', 'evidence_grading', 'price_comparison', 'alerts',
            'search_history', 'bookmarks', 'api_access', 'patient_management',
            'referrals', 'report_generation',
        ],
    },
};

// ═══════════════ HANDLER ═══════════════

module.exports = async function handler(req, res) {
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return;

    const clientIp = getClientIp(req);
    if (authRateLimiter(clientIp)) {
        return res.status(429).json({ error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.' });
    }

    // GET — return subscription info
    if (req.method === 'GET') {
        return handleGetSubscription(req, res);
    }

    // POST — upgrade or usage
    if (req.method === 'POST') {
        const { action } = req.body || {};
        if (action === 'usage') return handleUsageStats(req, res);
        if (action === 'upgrade') return handleUpgrade(req, res);
        if (action === 'downgrade') return handleDowngrade(req, res);
        return res.status(400).json({ error: "არასწორი action. გამოიყენეთ 'upgrade', 'downgrade', ან 'usage'." });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};


// ═══════════════ GET SUBSCRIPTION ═══════════════

async function handleGetSubscription(req, res) {
    const userId = await getUserId(req);

    // Try Railway backend first
    if (RAILWAY_BACKEND_URL && userId) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/subscription`, {
                headers: { 'Authorization': req.headers.authorization || '' },
            });
            if (resp.ok) {
                const data = await resp.json();
                return res.status(200).json(data);
            }
        } catch (e) {
            // Fallback to local tier info
        }
    }

    // Fallback: return tier definitions + free status
    return res.status(200).json({
        tier: 'free',
        tier_name: 'უფასო',
        price_gel: 0,
        features: TIERS.free.features,
        is_active: true,
        tiers: TIERS,
    });
}


// ═══════════════ UPGRADE ═══════════════

async function handleUpgrade(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    const { tier, payment_ref } = req.body || {};
    if (!tier || !['pro', 'doctor'].includes(tier)) {
        return res.status(400).json({ error: "არასწორი პაკეტი. აირჩიეთ 'pro' ან 'doctor'." });
    }

    // Try Railway backend
    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/subscription/upgrade`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                },
                body: JSON.stringify({ tier, payment_ref: payment_ref || '' }),
            });
            if (resp.ok) {
                const data = await resp.json();
                return res.status(200).json(data);
            }
        } catch (e) {
            // Fallback
        }
    }

    // STUB response — payment not yet integrated
    const tierDef = TIERS[tier];
    return res.status(200).json({
        status: 'stub',
        tier,
        tier_name: tierDef.name,
        price_gel: tierDef.price_gel,
        message: `პაკეტი "${tierDef.name}" (₾${tierDef.price_gel}/თვე) — გადახდის სისტემა მალე დაემატება.`,
        payment_note: 'გადახდის ინტეგრაცია მზადდება (Stripe / Bank of Georgia).',
    });
}


// ═══════════════ DOWNGRADE ═══════════════

async function handleDowngrade(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/subscription/downgrade`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || '',
                },
            });
            if (resp.ok) {
                return res.status(200).json(await resp.json());
            }
        } catch (e) {
            // Fallback
        }
    }

    return res.status(200).json({ status: 'დაქვეითდა', tier: 'free' });
}


// ═══════════════ USAGE STATS ═══════════════

async function handleUsageStats(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    if (RAILWAY_BACKEND_URL) {
        try {
            const resp = await fetch(`${RAILWAY_BACKEND_URL}/api/subscription/usage`, {
                headers: { 'Authorization': req.headers.authorization || '' },
            });
            if (resp.ok) {
                return res.status(200).json(await resp.json());
            }
        } catch (e) {
            // Fallback
        }
    }

    // Fallback: no data
    return res.status(200).json({
        searches_today: 0,
        searches_month: 0,
        tier: 'free',
        features: TIERS.free.features,
        daily_limit: 5,
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
