/**
 * Shared authentication helper for Vercel API endpoints.
 *
 * Verifies user identity via Supabase auth token.
 */

/**
 * Authenticate user from Authorization header using Supabase.
 *
 * @param {import('http').IncomingMessage} req - HTTP request
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - Supabase client
 * @returns {Promise<{user: object|null, token: string|null, error: string|null}>}
 */
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

module.exports = { authenticateUser };
