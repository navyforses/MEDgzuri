/**
 * MedGzuri Authentication API
 *
 * Endpoints (via action field):
 *   - signup:   Register new user (email + password)
 *   - login:    Sign in with email + password
 *   - logout:   Sign out current session
 *   - profile:  Get/update user profile
 *   - config:   Get Supabase public config (for frontend client)
 */

const { getServiceClient, getPublicConfig } = require('../lib/supabase');

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

    // Return public config (no auth required)
    if (action === 'config') {
        const config = getPublicConfig();
        if (!config.url) {
            return res.status(200).json({ configured: false });
        }
        return res.status(200).json({ configured: true, ...config });
    }

    const supabase = getServiceClient();
    if (!supabase) {
        return res.status(503).json({
            error: 'ავტორიზაციის სერვისი არ არის კონფიგურირებული.',
            fallback: true
        });
    }

    try {
        switch (action) {
            case 'signup': {
                const { email, password, fullName } = payload;
                if (!email || !password) {
                    return res.status(400).json({ error: 'ელ-ფოსტა და პაროლი სავალდებულოა.' });
                }
                if (password.length < 6) {
                    return res.status(400).json({ error: 'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.' });
                }

                const { data, error } = await supabase.auth.admin.createUser({
                    email,
                    password,
                    user_metadata: { full_name: fullName || '' },
                    email_confirm: true
                });

                if (error) {
                    console.error('[MedGzuri] Signup error:', error.message);
                    return res.status(400).json({ error: translateAuthError(error.message) });
                }

                return res.status(200).json({
                    success: true,
                    message: 'ანგარიში წარმატებით შეიქმნა.',
                    user: { id: data.user.id, email: data.user.email }
                });
            }

            case 'login': {
                const { email, password } = payload;
                if (!email || !password) {
                    return res.status(400).json({ error: 'ელ-ფოსტა და პაროლი სავალდებულოა.' });
                }

                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) {
                    console.error('[MedGzuri] Login error:', error.message);
                    return res.status(401).json({ error: translateAuthError(error.message) });
                }

                // Get user profile
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();

                return res.status(200).json({
                    success: true,
                    session: {
                        access_token: data.session.access_token,
                        refresh_token: data.session.refresh_token,
                        expires_at: data.session.expires_at
                    },
                    user: {
                        id: data.user.id,
                        email: data.user.email,
                        fullName: profile?.full_name || data.user.user_metadata?.full_name || '',
                        role: profile?.role || 'user'
                    }
                });
            }

            case 'profile': {
                const authHeader = req.headers.authorization;
                if (!authHeader?.startsWith('Bearer ')) {
                    return res.status(401).json({ error: 'ავტორიზაცია საჭიროა.' });
                }
                const token = authHeader.split(' ')[1];

                const { data: { user }, error: authError } = await supabase.auth.getUser(token);
                if (authError || !user) {
                    return res.status(401).json({ error: 'არასწორი ან ვადაგასული ტოკენი.' });
                }

                // GET profile
                if (!payload.update) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .single();

                    return res.status(200).json({ user: { ...profile, email: user.email } });
                }

                // UPDATE profile
                const { fullName, phone } = payload.update;
                const updates = {};
                if (fullName !== undefined) updates.full_name = fullName;
                if (phone !== undefined) updates.phone = phone;

                const { error: updateError } = await supabase
                    .from('profiles')
                    .update(updates)
                    .eq('id', user.id);

                if (updateError) {
                    return res.status(500).json({ error: 'პროფილის განახლება ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, message: 'პროფილი განახლდა.' });
            }

            default:
                return res.status(400).json({ error: 'უცნობი მოქმედება.' });
        }
    } catch (err) {
        console.error('[MedGzuri] Auth error:', err);
        return res.status(500).json({ error: 'სერვერის შეცდომა. გთხოვთ სცადოთ მოგვიანებით.' });
    }
};

function translateAuthError(msg) {
    const map = {
        'Invalid login credentials': 'არასწორი ელ-ფოსტა ან პაროლი.',
        'User already registered': 'ეს ელ-ფოსტა უკვე რეგისტრირებულია.',
        'Email not confirmed': 'ელ-ფოსტა ჯერ არ არის დადასტურებული.',
        'Password should be at least 6 characters': 'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.',
        'Unable to validate email address': 'ელ-ფოსტის ფორმატი არასწორია.'
    };
    for (const [key, val] of Object.entries(map)) {
        if (msg.includes(key)) return val;
    }
    return 'ავტორიზაციის შეცდომა. გთხოვთ სცადოთ მოგვიანებით.';
}
