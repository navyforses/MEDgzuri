/**
 * MedGzuri Chatbot API — Serverless Endpoint
 *
 * Forwards chat requests to Railway FastAPI backend.
 * Fallback: direct Claude call with conversation history.
 *
 * Endpoints (via request body "action"):
 *   - action: "start"   → Start new chat session
 *   - action: "message"  → Send message in existing session
 *   - action: "history"  → Get chat history
 *
 * @module api/chat
 */

const {
    setCorsHeaders,
    setSecurityHeaders,
    getClientIp,
    createRateLimiter,
} = require('../lib/security');

const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const chatRateLimiter = createRateLimiter(30, 60 * 1000); // 30 req/min for chat

// In-memory fallback session store (when Railway is unavailable)
const fallbackSessions = new Map();
const MAX_FALLBACK_SESSIONS = 200;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const clientIp = getClientIp(req);
        if (chatRateLimiter(clientIp)) {
            return res.status(429).json({
                error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.'
            });
        }

        const { action = 'message', session_id, message, search_context } = req.body || {};

        // Try Railway backend first
        const railwayResult = await proxyToRailway(action, { session_id, message, search_context });
        if (railwayResult) {
            return res.status(200).json(railwayResult);
        }

        // Fallback: handle locally with direct Claude calls
        if (action === 'start') {
            const newSessionId = crypto.randomUUID();
            cleanupExpiredSessions();

            if (fallbackSessions.size >= MAX_FALLBACK_SESSIONS) {
                // Remove oldest session
                const oldest = [...fallbackSessions.entries()]
                    .sort((a, b) => a[1].lastActive - b[1].lastActive)[0];
                if (oldest) fallbackSessions.delete(oldest[0]);
            }

            fallbackSessions.set(newSessionId, {
                history: [],
                searchContext: search_context || null,
                createdAt: Date.now(),
                lastActive: Date.now(),
            });

            return res.status(200).json({
                session_id: newSessionId,
                message: 'საუბარი დაწყებულია! როგორ შემიძლია დაგეხმაროთ?',
            });
        }

        if (action === 'history') {
            const session = fallbackSessions.get(session_id);
            if (!session) {
                return res.status(404).json({ error: 'სესია ვერ მოიძებნა.' });
            }
            return res.status(200).json({
                session_id,
                messages: session.history,
            });
        }

        // action === 'message'
        if (!session_id || !message) {
            return res.status(400).json({
                error: 'session_id და message აუცილებელია.',
            });
        }

        const session = fallbackSessions.get(session_id);
        if (!session) {
            return res.status(404).json({ error: 'სესია ვერ მოიძებნა. დაიწყეთ ახალი საუბარი.' });
        }

        session.lastActive = Date.now();
        session.history.push({ role: 'user', content: message, timestamp: Date.now() / 1000 });

        // Trim history
        if (session.history.length > 40) {
            session.history = session.history.slice(-40);
        }

        // Generate response via Claude
        const response = await generateChatResponse(session, message);
        session.history.push({ role: 'assistant', content: response, timestamp: Date.now() / 1000 });

        return res.status(200).json({
            session_id,
            response,
        });

    } catch (err) {
        console.error('[MedGzuri Chat] Error:', err);
        return res.status(500).json({
            error: 'ჩატბოტის შეცდომა. გთხოვთ სცადოთ თავიდან.',
        });
    }
};

// ═══════════════ RAILWAY PROXY ═══════════════

async function proxyToRailway(action, data) {
    if (!RAILWAY_BACKEND_URL) return null;

    try {
        const endpoint = action === 'history'
            ? `${RAILWAY_BACKEND_URL}/api/chat/${data.session_id}/history`
            : `${RAILWAY_BACKEND_URL}/api/chat`;

        const method = action === 'history' ? 'GET' : 'POST';
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };

        if (method === 'POST') {
            const body = { action };
            if (data.session_id) body.session_id = data.session_id;
            if (data.message) body.message = data.message;
            if (data.search_context) body.search_context = data.search_context;
            options.body = JSON.stringify(body);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        options.signal = controller.signal;

        const response = await fetch(endpoint, options);
        clearTimeout(timeout);

        if (response.ok) {
            return await response.json();
        }
        console.warn(`[MedGzuri Chat] Railway returned ${response.status}`);
        return null;
    } catch (err) {
        console.warn('[MedGzuri Chat] Railway proxy failed:', err.message?.slice(0, 100));
        return null;
    }
}

// ═══════════════ DIRECT CLAUDE FALLBACK ═══════════════

async function generateChatResponse(session, message) {
    if (!ANTHROPIC_API_KEY) {
        return 'მადლობა თქვენი კითხვისთვის! ეს არის სადემო რეჟიმი. სრული ფუნქციონალისთვის საჭიროა API კონფიგურაცია.\n\n⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.';
    }

    const systemPrompt = buildSystemPrompt(session);
    const conversationText = buildConversation(session);

    try {
        const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
        const CLAUDE_CHAT_MODEL = process.env.CLAUDE_CHAT_MODEL || 'claude-sonnet-4-6';
        const response = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: CLAUDE_CHAT_MODEL,
                max_tokens: 1500,
                system: systemPrompt,
                messages: [{ role: 'user', content: conversationText }],
            }),
        });

        if (!response.ok) {
            console.error('[MedGzuri Chat] Claude API error:', response.status);
            return 'სამწუხაროდ, ტექნიკური შეცდომა მოხდა. გთხოვთ სცადოთ თავიდან.\n\n⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.';
        }

        const data = await response.json();
        return data.content?.[0]?.text || 'პასუხი ვერ მოიძებნა.';
    } catch (err) {
        console.error('[MedGzuri Chat] Claude call failed:', err.message?.slice(0, 100));
        return 'სამწუხაროდ, ტექნიკური შეცდომა მოხდა. გთხოვთ სცადოთ თავიდან.\n\n⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.';
    }
}

function buildSystemPrompt(session) {
    let prompt = `შენ ხარ მედგზურის სამედიცინო ასისტენტი — ქართულენოვანი ჩატბოტი.

მთავარი წესები:
1. ყოველთვის უპასუხე ქართულ ენაზე.
2. არასოდეს დაუსვა დიაგნოზი — შენ არ ხარ ექიმი.
3. არასოდეს დანიშნო წამალი ან მკურნალობა.
4. ყოველთვის ურჩიე ექიმთან კონსულტაცია.
5. იყავი თანამგრძნობი, მოთმინე და პროფესიონალი.
6. პასუხები იყოს მოკლე და გასაგები (2-4 აბზაცი მაქსიმუმ).
`;

    if (session.searchContext) {
        const meta = session.searchContext.meta || '';
        const items = session.searchContext.items || [];
        const titles = items.slice(0, 5).map(i => i.title || '').filter(Boolean);
        prompt += `\nწინა ძიების კონტექსტი:\nთემა: ${meta}\nშედეგები:\n${titles.map(t => '- ' + t).join('\n')}\n`;
    }

    prompt += '\n⚕️ ყოველ პასუხში შეახსენე: მედგზური არ ანაცვლებს ექიმის კონსულტაციას.';
    return prompt;
}

function buildConversation(session) {
    const recent = session.history.slice(-10);
    return recent.map(msg => {
        const role = msg.role === 'user' ? 'მომხმარებელი' : 'ასისტენტი';
        return `${role}: ${msg.content}`;
    }).join('\n\n');
}

// ═══════════════ HELPERS ═══════════════

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of fallbackSessions) {
        if (now - session.lastActive > SESSION_TTL_MS) {
            fallbackSessions.delete(id);
        }
    }
}
