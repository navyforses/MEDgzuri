/**
 * MedGzuri Subscription API
 *
 * Endpoints:
 *   GET  /api/subscription           — get current tier + usage info
 *   POST /api/subscription (upgrade) — return Gumroad checkout URL
 *   POST /api/subscription (usage)   — get daily search usage
 *   POST /api/subscription (downgrade) — downgrade to free
 *
 * Tiers: free ($0, 3 searches/day) | pro ($9/month, unlimited)
 * Payment via Gumroad (webhook at /api/gumroad-webhook)
 */

const { getServiceClient } = require('../lib/supabase');
const {
    setCorsHeaders, setSecurityHeaders, authRateLimiter, getClientIp
} = require('../lib/security');

// ═══════════════ CONFIG ═══════════════

const GUMROAD_URL = process.env.GUMROAD_URL || 'https://grantkit.gumroad.com/l/grantkit';

const TIERS = {
    free: {
        name: 'უფასო',
        name_en: 'Free',
        price_usd: 0,
        daily_search_limit: 3,
        features: ['basic_search'],
    },
    pro: {
        name: 'პრო',
        name_en: 'Pro',
        price_usd: 9,
        daily_search_limit: -1,
        features: [
            'basic_search', 'evidence_grading', 'price_comparison',
            'alerts', 'search_history', 'bookmarks', 'grants_access', 'pdf_reports',
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

    if (req.method === 'GET') {
        return handleGetSubscription(req, res);
    }

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

    if (!userId) {
        return res.status(200).json({
            tier: 'free',
            searches_today: 0,
            daily_limit: 3,
            searches_remaining: 3,
            tiers: TIERS,
            gumroad_url: GUMROAD_URL,
        });
    }

    const supabase = getServiceClient();
    if (!supabase) {
        return res.status(200).json({ tier: 'free', tiers: TIERS, gumroad_url: GUMROAD_URL });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier, subscription_expires, daily_search_count, last_search_date')
        .eq('id', userId)
        .single();

    const tier = profile?.subscription_tier || 'free';
    const isExpired = tier === 'pro' && profile?.subscription_expires &&
        new Date(profile.subscription_expires) < new Date();
    const effectiveTier = isExpired ? 'free' : tier;

    const today = new Date().toISOString().split('T')[0];
    const searchesToday = (profile?.last_search_date === today)
        ? (profile.daily_search_count || 0) : 0;
    const dailyLimit = effectiveTier === 'free' ? 3 : -1;

    return res.status(200).json({
        tier: effectiveTier,
        tier_name: TIERS[effectiveTier].name,
        searches_today: searchesToday,
        daily_limit: dailyLimit,
        searches_remaining: effectiveTier === 'free' ? Math.max(0, 3 - searchesToday) : -1,
        features: TIERS[effectiveTier].features,
        subscription_expires: profile?.subscription_expires || null,
        tiers: TIERS,
        gumroad_url: GUMROAD_URL,
    });
}


// ═══════════════ UPGRADE ═══════════════

async function handleUpgrade(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    return res.status(200).json({
        status: 'redirect',
        gumroad_url: GUMROAD_URL,
        message: 'გადადით Gumroad-ზე გამოწერის გასაფორმებლად ($9/თვე).',
    });
}


// ═══════════════ DOWNGRADE ═══════════════

async function handleDowngrade(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    const supabase = getServiceClient();
    if (supabase) {
        await supabase.from('profiles').update({
            subscription_tier: 'free',
            subscription_expires: null,
            gumroad_license_key: null,
        }).eq('id', userId);
    }

    return res.status(200).json({ status: 'ok', tier: 'free', message: 'გამოწერა გაუქმდა.' });
}


// ═══════════════ USAGE STATS ═══════════════

async function handleUsageStats(req, res) {
    const userId = await getUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია.' });
    }

    const supabase = getServiceClient();
    if (!supabase) {
        return res.status(200).json({ searches_today: 0, tier: 'free', daily_limit: 3 });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier, daily_search_count, last_search_date')
        .eq('id', userId)
        .single();

    const tier = profile?.subscription_tier || 'free';
    const today = new Date().toISOString().split('T')[0];
    const searchesToday = (profile?.last_search_date === today)
        ? (profile.daily_search_count || 0) : 0;

    return res.status(200).json({
        searches_today: searchesToday,
        tier,
        features: TIERS[tier]?.features || TIERS.free.features,
        daily_limit: tier === 'free' ? 3 : -1,
        searches_remaining: tier === 'free' ? Math.max(0, 3 - searchesToday) : -1,
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
