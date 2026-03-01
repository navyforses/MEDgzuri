/**
 * MedGzuri Security Utilities
 *
 * საერთო უსაფრთხოების ფუნქციები ყველა API endpoint-ისთვის:
 *   - CORS კონფიგურაცია (origin whitelist)
 *   - უსაფრთხოების HTTP headers
 *   - Rate limiting (IP-based, serverless-compatible caveat)
 *   - Input sanitization
 *   - Password validation
 */

// ═══════════════ CORS ═══════════════

/**
 * Default allowed origins — production domain + localhost dev
 * Override with ALLOWED_ORIGINS env var (comma-separated)
 */
const DEFAULT_ALLOWED_ORIGINS = [
    'https://medgzuri.com',
    'https://www.medgzuri.com',
    'https://medgzuri.vercel.app',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

function getAllowedOrigins() {
    if (process.env.ALLOWED_ORIGINS) {
        return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    }
    return DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Set CORS headers. Returns true if this is a preflight (OPTIONS) request
 * that was already handled.
 */
function setCorsHeaders(req, res) {
    const allowedOrigins = getAllowedOrigins();
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    // If no origin header or not in list, don't set ACAO (browser blocks cross-origin)

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

// ═══════════════ SECURITY HEADERS ═══════════════

function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Content-Security-Policy for API responses (JSON only)
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

// ═══════════════ RATE LIMITER ═══════════════

/**
 * In-memory rate limiter.
 *
 * ⚠ შეზღუდვა: Vercel serverless-ზე თითოეული instance-ის მეხსიერება
 * იზოლირებულია. ეს rate limiter მუშაობს cold start-ების დროს, მაგრამ
 * მრავალ instance-ზე განაწილებული ტრაფიკისთვის საჭიროა
 * გარე store (Redis/Upstash). TODO: Phase 2 — Upstash Redis integration.
 */
const rateLimitStore = new Map();

function createRateLimiter(maxRequests, windowMs) {
    return function isRateLimited(ip) {
        const now = Date.now();
        const entry = rateLimitStore.get(ip);

        if (!entry || now - entry.windowStart > windowMs) {
            rateLimitStore.set(ip, { windowStart: now, count: 1 });
            return false;
        }

        entry.count++;
        return entry.count > maxRequests;
    };
}

// Periodic cleanup (every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore) {
        if (now - entry.windowStart > 120000) { // 2 min stale
            rateLimitStore.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// Pre-configured limiters
const searchRateLimiter = createRateLimiter(20, 60 * 1000);    // 20 req/min
const authRateLimiter = createRateLimiter(5, 60 * 1000);       // 5 req/min (brute-force protection)
const leadsRateLimiter = createRateLimiter(10, 60 * 1000);     // 10 req/min

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
}

// ═══════════════ PASSWORD VALIDATION ═══════════════

/**
 * პაროლის ვალიდაცია:
 *   - მინიმუმ 8 სიმბოლო
 *   - მინიმუმ 1 დიდი ასო
 *   - მინიმუმ 1 პატარა ასო
 *   - მინიმუმ 1 ციფრი
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'პაროლი სავალდებულოა.' };
    }
    if (password.length < 8) {
        return { valid: false, error: 'პაროლი მინიმუმ 8 სიმბოლო უნდა იყოს.' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'პაროლი უნდა შეიცავდეს მინიმუმ 1 დიდ ასოს.' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'პაროლი უნდა შეიცავდეს მინიმუმ 1 პატარა ასოს.' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'პაროლი უნდა შეიცავდეს მინიმუმ 1 ციფრს.' };
    }
    return { valid: true };
}

// ═══════════════ INPUT SANITIZATION ═══════════════

/**
 * Sanitize string input — trim, length limit, strip control chars
 */
function sanitizeString(input, maxLength = 2000) {
    if (!input || typeof input !== 'string') return '';
    // Strip control characters (except newlines and tabs)
    let clean = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return clean.trim().substring(0, maxLength);
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email) && email.length <= 254;
}

/**
 * Validate phone format (Georgian and international)
 */
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    return /^\+?[0-9]{7,15}$/.test(cleaned);
}

module.exports = {
    setCorsHeaders,
    setSecurityHeaders,
    getAllowedOrigins,
    searchRateLimiter,
    authRateLimiter,
    leadsRateLimiter,
    getClientIp,
    validatePassword,
    sanitizeString,
    isValidEmail,
    isValidPhone,
    createRateLimiter
};
