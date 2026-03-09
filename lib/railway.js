/**
 * Shared Railway backend proxy helper for Vercel API endpoints.
 *
 * Forwards authenticated requests to the Railway FastAPI backend
 * with configurable endpoint paths and HTTP methods.
 */

const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;

/**
 * Action configuration: maps action names to HTTP method and URL builder.
 * @typedef {{method: string, buildUrl: (base: string, payload: object) => string, hasBody?: boolean}} ActionConfig
 */

/**
 * Proxy a request to Railway backend.
 *
 * @param {string} basePath - API path prefix (e.g., "/api/alerts")
 * @param {Object<string, ActionConfig>} actionMap - Map of action names to HTTP config
 * @param {string} action - The action to perform
 * @param {string} token - Bearer token for auth
 * @param {object|null} payload - Request payload
 * @param {string} [logPrefix='Railway'] - Log prefix for warnings
 * @returns {Promise<object|null>} Parsed JSON response, or null on failure
 */
async function tryRailway(basePath, actionMap, action, token, payload, logPrefix = 'Railway') {
    if (!RAILWAY_BACKEND_URL) return null;

    const config = actionMap[action];
    if (!config) return null;

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        const url = config.buildUrl
            ? config.buildUrl(RAILWAY_BACKEND_URL + basePath, payload)
            : RAILWAY_BACKEND_URL + basePath;

        const resp = await fetch(url, {
            method: config.method,
            headers,
            body: config.hasBody !== false && payload ? JSON.stringify(payload) : undefined,
            signal: AbortSignal.timeout(10000)
        });

        if (!resp.ok) return null;
        if (resp.status === 204) return { success: true };
        return await resp.json();
    } catch (err) {
        console.warn(`[MedGzuri] ${logPrefix} proxy failed:`, err.message);
        return null;
    }
}

module.exports = { tryRailway };
