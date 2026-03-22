/**
 * MedGzuri Bookmarks API
 *
 * მომხმარებლის სანიშნეების მართვა:
 *   - add:    ახალი სანიშნის დამატება
 *   - list:   სანიშნეების სიის მიღება
 *   - delete: სანიშნის წაშლა
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

const bookmarksRateLimiter = createRateLimiter(10, 60 * 1000); // 10 req/min

// ═══════════════ RAILWAY ACTION MAP ═══════════════

const BOOKMARKS_ACTIONS = {
    add:    { method: 'POST', buildUrl: (base) => base },
    list:   { method: 'GET',  buildUrl: (base) => base, hasBody: false },
    delete: { method: 'DELETE', buildUrl: (base, p) => `${base}/${p.id}`, hasBody: false },
};

function tryRailway(action, token, payload) {
    return tryRailwayProxy('/api/bookmarks', BOOKMARKS_ACTIONS, action, token, payload, 'bookmarks');
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
    if (bookmarksRateLimiter(clientIp)) {
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
            case 'add': {
                const { title, source, body: itemBody, tags, url, searchType } = payload;

                if (!title) {
                    return res.status(400).json({ error: 'სათაური სავალდებულოა.' });
                }

                // Try Railway first
                const railwayResult = await tryRailway('add', token, {
                    title: sanitizeString(title, 500),
                    source: sanitizeString(source, 200),
                    body: sanitizeString(itemBody, 5000),
                    tags: Array.isArray(tags) ? tags.map(t => sanitizeString(t, 50)) : [],
                    url: sanitizeString(url, 2000),
                    search_type: sanitizeString(searchType, 50)
                });
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const { data, error } = await supabase
                    .from('user_bookmarks')
                    .insert({
                        user_id: user.id,
                        title: sanitizeString(title, 500),
                        source: sanitizeString(source, 200),
                        body: sanitizeString(itemBody, 5000),
                        tags: Array.isArray(tags) ? tags.map(t => sanitizeString(t, 50)) : [],
                        url: sanitizeString(url, 2000),
                        search_type: sanitizeString(searchType, 50),
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) {
                    console.error('[MedGzuri] Bookmark add error:', error.message);
                    return res.status(500).json({ error: 'სანიშნის დამატება ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, bookmark: data });
            }

            case 'list': {
                // Try Railway first
                const railwayResult = await tryRailway('list', token, null);
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase
                const { data: bookmarks, error } = await supabase
                    .from('user_bookmarks')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('[MedGzuri] Bookmark list error:', error.message);
                    return res.status(500).json({ error: 'სანიშნეების მიღება ვერ მოხერხდა.' });
                }

                return res.status(200).json({ bookmarks: bookmarks || [] });
            }

            case 'delete': {
                const { id } = payload;
                if (!id) {
                    return res.status(400).json({ error: 'სანიშნის ID სავალდებულოა.' });
                }

                // Try Railway first
                const railwayResult = await tryRailway('delete', token, { id });
                if (railwayResult) {
                    return res.status(200).json(railwayResult);
                }

                // Fallback: direct Supabase (ensure user owns the bookmark)
                const { error } = await supabase
                    .from('user_bookmarks')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) {
                    console.error('[MedGzuri] Bookmark delete error:', error.message);
                    return res.status(500).json({ error: 'სანიშნის წაშლა ვერ მოხერხდა.' });
                }

                return res.status(200).json({ success: true, message: 'სანიშნი წაიშალა.' });
            }

            default:
                return res.status(400).json({ error: 'უცნობი მოქმედება. მხარდაჭერილია: add, list, delete' });
        }
    } catch (err) {
        console.error('[MedGzuri] Bookmarks error:', err);
        return res.status(500).json({ error: 'სერვერის შეცდომა. გთხოვთ სცადოთ მოგვიანებით.' });
    }
};
