/**
 * MedGzuri Gumroad Webhook
 *
 * POST /api/gumroad-webhook
 *
 * Receives Gumroad's webhook on subscription events.
 * Updates profiles.subscription_tier based on purchase/refund.
 * If user not found by email, stores in pending_subscriptions.
 */

const { getServiceClient } = require('../lib/supabase');
const { setSecurityHeaders } = require('../lib/security');

// ═══════════════ HANDLER ═══════════════

module.exports = async function handler(req, res) {
    setSecurityHeaders(res);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        seller_id, email, license_key, product_permalink,
        refunded, subscription_id, test,
    } = req.body || {};

    // Verify seller_id if configured
    const expectedSeller = process.env.GUMROAD_SELLER_ID;
    if (expectedSeller && seller_id !== expectedSeller) {
        return res.status(403).json({ error: 'Invalid seller' });
    }

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    const supabase = getServiceClient();
    if (!supabase) {
        return res.status(500).json({ error: 'Database unavailable' });
    }

    // Find user by email in Supabase auth
    const { data: userList } = await supabase.auth.admin.listUsers();
    const user = userList?.users?.find(u =>
        u.email?.toLowerCase() === email.toLowerCase()
    );

    if (refunded === true || refunded === 'true') {
        // Refund — downgrade to free
        if (user) {
            await supabase.from('profiles').update({
                subscription_tier: 'free',
                subscription_expires: null,
                gumroad_license_key: null,
            }).eq('id', user.id);
        }
        return res.status(200).json({ status: 'downgraded' });
    }

    if (!user) {
        // User hasn't signed up yet — store for later matching
        await supabase.from('pending_subscriptions').insert({
            email: email.toLowerCase(),
            license_key: license_key || null,
        });
        return res.status(200).json({ status: 'pending', message: 'User not found, stored for later' });
    }

    // Upgrade to pro
    const expires = new Date();
    expires.setDate(expires.getDate() + 35); // 30 days + 5 day grace

    await supabase.from('profiles').update({
        subscription_tier: 'pro',
        subscription_expires: expires.toISOString(),
        gumroad_license_key: license_key || null,
    }).eq('id', user.id);

    return res.status(200).json({ status: 'upgraded', tier: 'pro' });
};
