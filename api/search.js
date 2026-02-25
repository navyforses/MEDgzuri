/**
 * MedGzuri AI Search API — Serverless Endpoint
 *
 * Orchestrates a multi-AI search pipeline for Georgian-language medical research:
 *
 *   Request  ──►  Cache  ──►  n8n (optional)  ──►  Perplexity  ──►  Claude  ──►  Response
 *                  hit?         multi-agent          web search       structure
 *                   │              │                     │              & translate
 *                   ▼              ▼                     ▼                  │
 *                 return        return               fallback ◄────────────┘
 *
 * Pipeline stages:
 *   1. Perplexity API — web search for medical research, clinical trials, clinics
 *   2. Anthropic Claude — analysis, structuring, and Georgian translation
 *   3. OpenAI GPT — verification and fact-checking (Phase 2, not yet active)
 *
 * Search types:
 *   - "research"  — PubMed/ClinicalTrials.gov literature search
 *   - "symptoms"  — test & specialist recommendations (never diagnoses)
 *   - "clinics"   — global hospital/clinic search with pricing
 *   - "report"    — PDF report generation from prior search results
 *
 * Graceful degradation:
 *   n8n failure  →  direct Perplexity+Claude pipeline
 *   Claude failure →  raw Perplexity results
 *   Both fail     →  demo/mock data
 *
 * @module api/search
 */

// ═══════════════ CONFIG ═══════════════
/** @type {string|undefined} */
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
/** @type {string|undefined} */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
/** @type {string|undefined} */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
/** @type {string|undefined} */
const N8N_WEBHOOK_BASE_URL = process.env.N8N_WEBHOOK_BASE_URL;
/** @type {string|undefined} */
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;
/** @type {string|undefined} */
const SUPABASE_URL = process.env.SUPABASE_URL;
/** @type {string|undefined} */
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ═══════════════ IN-MEMORY CACHE (LRU + TTL) ═══════════════
/**
 * LRU cache with time-based expiration.
 *
 * Uses a Map (insertion-ordered) for O(1) get/set/delete.
 * On access, entries are moved to the tail (most-recently-used).
 * On insert beyond capacity, the head (least-recently-used) is evicted.
 *
 * Complexity:
 *   getCacheKey — O(n) where n = JSON-serialized input length (unavoidable)
 *   cacheGet    — O(1) amortized (Map.get + delete + set)
 *   cacheSet    — O(1) amortized
 *
 * Previous issue: TTL-expired entries were never proactively purged, only
 * evicted by LRU pressure. Now a periodic sweep removes stale entries,
 * bounding memory to min(CACHE_MAX_SIZE, active entries).
 */
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();

/**
 * Build a cache key from search type + input data.
 * Uses djb2 hash over the canonical JSON representation.
 *
 * @param {string} type  - Search type (research|symptoms|clinics)
 * @param {object} data  - Search parameters
 * @returns {string}       Cache key in the form "type:hash"
 */
function getCacheKey(type, data) {
    const normalized = JSON.stringify({ type, ...data });
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return `${type}:${hash}`;
}

/**
 * Retrieve a cached entry, returning null on miss or expiry.
 * Promotes the entry to most-recently-used on hit.
 *
 * @param {string} key
 * @returns {object|null}
 */
function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    // Move to end (LRU promotion) — O(1)
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
}

/**
 * Store a result in the cache, evicting the LRU entry if at capacity.
 *
 * @param {string} key
 * @param {object} data
 */
function cacheSet(key, data) {
    // If updating an existing key, delete first to refresh LRU position
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= CACHE_MAX_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, { data, ts: Date.now() });
}

/**
 * Periodic TTL sweep — removes expired entries to prevent memory creep.
 * Runs every 5 minutes. O(n) scan but n ≤ CACHE_MAX_SIZE = 100.
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.ts > CACHE_TTL_MS) {
            cache.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ═══════════════ RATE LIMITER ═══════════════
/**
 * Fixed-window rate limiter using an in-memory Map.
 *
 * Each IP gets a counter that resets after RATE_LIMIT_WINDOW_MS.
 * Stale entries are purged every 5 minutes to bound memory.
 *
 * Complexity: O(1) per request check, O(n) periodic cleanup where n = unique IPs.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1-minute window
const RATE_LIMIT_MAX = 20;              // max requests per IP per window
const rateLimitMap = new Map();

/**
 * Check whether a client IP has exceeded the rate limit.
 *
 * @param {string} ip - Client IP address
 * @returns {boolean}   true if the IP should be throttled
 */
function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { windowStart: now, count: 1 });
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

// Periodic cleanup — remove entries whose window expired > 2× ago
setInterval(() => {
    const now = Date.now();
    const cutoff = RATE_LIMIT_WINDOW_MS * 2;
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > cutoff) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// ═══════════════ SEARCH LOGGING (Supabase) ═══════════════
/**
 * Fire-and-forget search telemetry to Supabase.
 *
 * Called without `await` in the handler so it never blocks the response.
 * Failures are silently logged — logging should never degrade the user experience.
 *
 * @param {string} type       - Search type
 * @param {object} data       - Original request payload
 * @param {object} resultMeta - API result (used for item count)
 * @param {number} pipelineMs - Total pipeline duration in ms
 * @param {string} source     - Which pipeline served the result (n8n|direct|cache)
 * @param {string} clientIp   - Client IP for analytics
 */
async function logSearch(type, data, resultMeta, pipelineMs, source, clientIp) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/search_logs`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                search_type: type,
                query: data.diagnosis || data.symptoms || data.notes || '',
                result_count: resultMeta?.items?.length || 0,
                pipeline_ms: pipelineMs,
                source,
                client_ip: clientIp,
                created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('[MedGzuri] Search log failed:', err.message);
    }
}

// ═══════════════ HANDLER ═══════════════

/** Set of valid search types — O(1) lookup vs O(n) Array.includes */
const VALID_TYPES = new Set(['research', 'symptoms', 'clinics', 'report']);

/** Dispatch table mapping search types to their handler functions */
const SEARCH_HANDLERS = {
    research: (data) => searchResearch(data),
    symptoms: (data) => analyzeSymptoms(data),
    clinics:  (data) => searchClinics(data),
    report:   (data) => generateReport(data.reportType, data.searchResult),
};

/**
 * Main request handler — Vercel serverless entry point.
 *
 * Flow:
 *   1. CORS + method check
 *   2. Rate limiting by IP
 *   3. Input validation (type, text lengths, age range)
 *   4. LRU cache check (skip for reports)
 *   5. Demo mode fallback if no API keys
 *   6. n8n multi-agent pipeline attempt
 *   7. Direct Perplexity → Claude pipeline fallback
 *   8. Cache result + async logging
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
    // CORS — restrict to allowed origins when configured
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['*'];
    const origin = req.headers.origin || '*';
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Rate limiting — extract first IP from X-Forwarded-For chain
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket?.remoteAddress
            || 'unknown';
        if (isRateLimited(clientIp)) {
            return res.status(429).json({
                error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.'
            });
        }

        const { type, data } = req.body;

        if (!type || !data) {
            return res.status(400).json({ error: 'Missing type or data' });
        }

        // Validate search type — O(1) Set lookup instead of O(n) array scan
        if (!VALID_TYPES.has(type)) {
            return res.status(400).json({ error: 'Invalid search type' });
        }

        // Input validation — guard against oversized payloads
        const MAX_TEXT_LENGTH = 2000;
        const textFields = [
            data.diagnosis, data.symptoms, data.context,
            data.notes, data.existingConditions, data.medications
        ];
        for (const field of textFields) {
            if (field && typeof field === 'string' && field.length > MAX_TEXT_LENGTH) {
                return res.status(400).json({ error: 'Input too long' });
            }
        }
        if (data.age && (isNaN(data.age) || data.age < 0 || data.age > 150)) {
            return res.status(400).json({ error: 'Invalid age' });
        }

        // Cache check — compute key once, reuse for both get and set
        let cacheKey;
        if (type !== 'report') {
            cacheKey = getCacheKey(type, data);
            const cached = cacheGet(cacheKey);
            if (cached) {
                console.log(`[MedGzuri] Cache HIT for ${type}`);
                cached._cached = true;
                cached._pipeline = { ms: 0, source: 'cache' };
                return res.status(200).json(cached);
            }
        }

        // Demo mode — return mock data when no API keys are configured
        if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
            console.log('[MedGzuri] No API keys configured, returning demo data');
            const demoResult = type === 'report'
                ? getDemoReport(data.reportType, data.searchResult)
                : getDemoResult(type, data);
            demoResult.isDemo = true;
            return res.status(200).json(demoResult);
        }

        // Pipeline execution
        const pipelineStart = Date.now();

        // Try n8n multi-agent pipeline first
        let result = await proxyToN8n(type, data);
        const n8nStatus = result ? 'success' : (N8N_WEBHOOK_BASE_URL ? 'failed' : 'skipped');

        // Fallback to direct pipeline via dispatch table (eliminates switch/case)
        if (!result) {
            result = await SEARCH_HANDLERS[type](data);
        }

        // Pipeline metadata
        const pipelineMs = Date.now() - pipelineStart;
        const pipelineSource = n8nStatus === 'success' ? 'n8n' : 'direct';
        console.log(`[MedGzuri] Pipeline completed in ${pipelineMs}ms | n8n: ${n8nStatus} | type: ${type}`);
        result._pipeline = { ms: pipelineMs, n8n: n8nStatus };

        // Cache the result (reports are unique, skip caching)
        if (cacheKey) {
            cacheSet(cacheKey, result);
        }

        // Log search to Supabase (fire-and-forget — never blocks response)
        logSearch(type, data, result, pipelineMs, pipelineSource, clientIp);

        return res.status(200).json(result);

    } catch (err) {
        console.error('[MedGzuri] Search error:', err);
        return res.status(500).json({
            error: 'ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით.'
        });
    }
};

// ═══════════════ SEARCH: RESEARCH ═══════════════
/**
 * Research pipeline: Perplexity web search → Claude structuring.
 *
 * Searches PubMed, ClinicalTrials.gov, and medical literature for the
 * given diagnosis, then structures results into Georgian-language items.
 *
 * @param {object} data - { diagnosis, ageGroup, researchType, context, regions }
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function searchResearch(data) {
    const { diagnosis, ageGroup, researchType, context, regions } = data;

    const searchQuery = buildResearchQuery(diagnosis, ageGroup, researchType, context);
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'research',
        query: diagnosis,
        searchResults,
        context: { ageGroup, researchType, regions, additionalContext: context }
    });
}

// ═══════════════ SEARCH: SYMPTOMS ═══════════════
/**
 * Symptom analysis pipeline: Perplexity search → Claude analysis.
 *
 * Recommends tests and specialists — never provides a diagnosis.
 *
 * @param {object} data - { symptoms, age, sex, existingConditions, medications }
 * @returns {Promise<object>} Analysis result with meta + items[]
 */
async function analyzeSymptoms(data) {
    const { symptoms, age, sex, existingConditions, medications } = data;

    const searchQuery = `medical tests and examinations for symptoms: ${symptoms}. Patient age: ${age || 'not specified'}, sex: ${sex || 'not specified'}. Existing conditions: ${existingConditions || 'none'}`;
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'symptoms',
        query: symptoms,
        searchResults,
        context: { age, sex, existingConditions, medications }
    });
}

// ═══════════════ SEARCH: CLINICS ═══════════════
/**
 * Clinic search pipeline: Perplexity search → Claude structuring.
 *
 * Finds hospitals and clinics worldwide with pricing and treatment details.
 *
 * @param {object} data - { diagnosis, countries, budget, language, notes }
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function searchClinics(data) {
    const { diagnosis, countries, budget, language, notes } = data;

    const countryStr = countries.length > 0 ? countries.join(', ') : 'worldwide';
    const searchQuery = `best hospitals and clinics for ${diagnosis} in ${countryStr}. Treatment options, estimated costs, patient reviews. ${budget ? `Budget range: ${budget}` : ''} ${notes || ''}`;
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'clinics',
        query: diagnosis,
        searchResults,
        context: { countries, budget, language, notes }
    });
}

// ═══════════════ REPORT GENERATION ═══════════════
async function generateReport(reportType, searchResult) {
    if (!ANTHROPIC_API_KEY) {
        return getDemoReport(reportType, searchResult);
    }

    const reportPrompt = `შენ ხარ მედგზურის სამედიცინო ანგარიშის ავტორი. მოგეცემა ძიების შედეგები და შენ უნდა შექმნა სრული, პროფესიული სამედიცინო ანგარიში ქართულ ენაზე.

ენობრივი მოთხოვნები:
- გამოიყენე ლიტერატურული ქართული ენა, სწორი ბრუნვები და ზმნის ფორმები
- სამედიცინო ტერმინოლოგია მხოლოდ ქართულად
- წინადადებები სრული, გრამატიკულად გამართული და პროფესიული ტონით
- აბზაცები ლოგიკურად დაკავშირებული და თანმიმდევრული

ანგარიშის სტრუქტურა:
1. შესავალი — თემის მოკლე აღწერა და ანგარიშის მიზანი
2. მიმოხილვა — ძირითადი მიგნებები და არსებული მონაცემების ანალიზი
3. დეტალური ანალიზი — თითოეული მნიშვნელოვანი აღმოჩენის განხილვა
4. რეკომენდაციები — კონკრეტული, ქმედითი რჩევები
5. დასკვნა — შეჯამება და შემდეგი ნაბიჯები

პასუხი მხოლოდ JSON ფორმატში:
{
  "title": "ანგარიშის სათაური",
  "sections": [
    { "heading": "სექციის სათაური", "content": "სრული ტექსტი აბზაცებით" }
  ],
  "disclaimer": "სამედიცინო პასუხისმგებლობის უარყოფა"
}`;

    const userMessage = `ანგარიშის ტიპი: ${reportType || 'research'}
ძიების შედეგები: ${JSON.stringify(searchResult)}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250514',
                max_tokens: 4000,
                system: reportPrompt,
                messages: [{ role: 'user', content: userMessage }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Claude report error:', response.status, errorBody);
            return getDemoReport(reportType, searchResult);
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        const parsed = extractJSON(text);
        if (parsed && parsed.sections) {
            return parsed;
        }

        return {
            title: 'სამედიცინო ანგარიში',
            sections: [{ heading: 'ანგარიში', content: text }],
            disclaimer: 'ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას.'
        };
    } catch (err) {
        console.error('[MedGzuri] Report generation failed:', err.message);
        return getDemoReport(reportType, searchResult);
    }
}

function getDemoReport(reportType, searchResult) {
    const query = searchResult?.meta || 'სამედიცინო მოთხოვნა';
    return {
        title: `სამედიცინო ანგარიში — ${query}`,
        isDemo: true,
        sections: [
            {
                heading: 'შესავალი',
                content: 'წინამდებარე ანგარიში წარმოადგენს სადემონსტრაციო დოკუმენტს. რეალური ანგარიშის გენერაციისთვის სახიროა სისტემის სრული კონფიგურაცია. ანგარიში მომზადებულია ხელმისაწვდომი სამედიცინო ლიტერატურისა და კზინიკური მონაცემების საფუძველზე.'
            },
            {
                heading: 'მიმოხილვა',
                content: 'ძიების შედეგების ანალიზის საფუძველზე გამოვლინდა რამდენიმე მნიშვნელოვანი მიგნება. აღნიშნული მიგნებები ეფუძნება თანამედროვე სამედიცინო კვლევებსა და კლინიკურ პრაქტიკას.'
            },
            {
                heading: 'რეკომენდაციები',
                content: 'რეკომენდირებულია კონსულტაცია შესაბამის სამედიცინო სპეციალისტთან. დამატებითი გამოკვლევების ჩატარება დაგეხმარებათ უფრო ზუსტი სურათის შექმნაში.'
            },
            {
                heading: 'დასკვნა',
                content: 'ეს სადემონსტრაციო ანგარიში ასახავს დოკუმენტის სტრუქტურასა და ფორმატს. სრული ანგარიში მოიცავს დეტალურ ანალიზს, წყაროების მითითებას და პერსონალიზებულ რეკომენდაციებს.'
            }
        ],
        disclaimer: 'ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას. ყველა სამედიცინო გადაწყვეტილება უნდა მიიღოთ კვალიფიციურ სპეციალისტთან ერთად.'
    };
}

// ═══════════════ PERPLEXITY API ═══════════════
/**
 * Search the web for medical information using Perplexity AI.
 *
 * Returns structured search results with citations, or null on failure.
 * Uses the "sonar" model with low temperature for factual responses.
 * Timeout: 30 seconds.
 *
 * @param {string} query - Natural language search query
 * @returns {Promise<{text: string, citations: string[]}|null>}
 */
async function perplexitySearch(query) {
    if (!PERPLEXITY_API_KEY) {
        console.log('[MedGzuri] Perplexity API key not set, skipping');
        return null;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a medical research assistant for MedGzuri, a Georgian healthcare platform. Search for the most recent, evidence-based medical information. Structure your response as clearly numbered points. For each finding include: the study/source name, key results, and clinical relevance. Include specific studies, clinical trials, hospital names, treatment details, and costs where available. Always cite sources with URLs. IMPORTANT: Write your response in Georgian (ქართული ენა). Use Georgian script for all text except proper nouns, journal names, and URLs. Medical terminology should be in Georgian with Latin/English terms in parentheses where helpful.'
                    },
                    { role: 'user', content: query }
                ],
                max_tokens: 2000,
                temperature: 0.1,
                return_citations: true
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Perplexity error:', response.status, errorBody);
            return null;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';
        console.log(`[MedGzuri] Perplexity success: ${content.length} chars, ${(result.citations || []).length} citations`);
        return {
            text: content,
            citations: result.citations || []
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] Perplexity request timed out (30s)');
        } else {
            console.error('[MedGzuri] Perplexity request failed:', err.message);
        }
        return null;
    }
}

// ═══════════════ CLAUDE API ═══════════════
/**
 * Analyze and structure search results using Anthropic Claude.
 *
 * Takes raw Perplexity search results and transforms them into structured,
 * Georgian-language JSON with items, tags, and metadata.
 *
 * Includes a Georgian content validation step: if < 50% of items contain
 * Georgian text, a follow-up translation request is made (with its own timeout).
 *
 * Fallback chain: Claude failure → raw Perplexity results → demo data
 *
 * @param {object} params
 * @param {string} params.role          - System prompt key (research|symptoms|clinics)
 * @param {string} params.query         - Original user query
 * @param {object|null} params.searchResults - Perplexity results { text, citations }
 * @param {object} params.context       - Additional search context
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function claudeAnalyze({ role, query, searchResults, context }) {
    if (!ANTHROPIC_API_KEY) {
        // Fallback: return raw search results formatted
        if (searchResults?.text) {
            return await formatRawResults(role, query, searchResults);
        }
        return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
    }

    const grammarRules = `

კრიტიკული ენობრივი მოთხოვნები (სავალდებულო):
- ყველა ტექსტი, სათაური, აღწერა და ტეგი უნდა იყოს მხოლოდ ქართულ ენაზე
- აკრძალულია ინგლისური ტექსტის გამოყენება (გარდა URL ლინკებისა და სამეცნიერო ჟურნალის სახელებისა)
- გამოიყენე ლიტერატურული ქართული ენა, სწორი ბრუნვები და ზმნის ფორმები
- სამედიცინო ტერმინოლოგია ქართულად (შეგიძლია ფრჩხილებში მიუთითო ლათინური/ინგლისური ტერმინი საჭიროებისას)
- წინადადებები სრული და გრამატიკულად გამართული უნდა იყოს
- გამოიყენე პროფესიული სამედიცინო რეგისტრი
- თითოეულ item-ის body ველში: მინიმუმ 3-5 სრული, შინაარსიანი წინადადება. გამოიყენე markdown ფორმატირება (bold, lists, headers)
- body ველში შეგიძლია გამოიყენო: **bold** ტექსტი, - ბულეტ სიები, ### ქვესათაურები, [ლინკის ტექსტი](url) ფორმატი
- JSON ველების მნიშვნელობები (title, body, source, tags, meta) - ყველა ქართულად!
- CRITICAL: არ დაყო ინფორმაცია მრავაზ პატარა item-ად. ჯობია 3-4 ვრცელი item, ვიდრე 8-10 ცარიელი`;

    const systemPrompts = {
        research: `შენ ხარ მედგზურის სამედიცინო კვლევის ექსპერტი. მომხმარებელმა მოგაწოდა დიაგნოზი და სამედიცინო კონტექსტი. ინტერნეტ ძიების შედეგების საფუძველზე, შექმენი სტრუქტურირებული პასუხი ქართულ ენაზე.

პასუხი უნდა მოიცავდეს:
1. დაავადების მოკლე მიმოხილვა
2. უახლესი კვლევები (სათაური, წყარო, ძირითადი მიგნებები)
3. აქტიური კლინიკური კვლევები (თუ არსებობს)
4. მკურნალობის ვარიანტები (სტანდარტული და ექსპერიმენტული)
5. რეკომენდაცია შემდეგი ნაბიჯებისთვის
${grammarRules}

პასუხი უნდა იყოს მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ისაგ გარეთ):
{
  "meta": "ნაპოვნია X კვლევა, Y კლინიკური კვლევა",
  "items": [
    { "title": "სათაური", "source": "წყარო", "body": "აღწერა", "tags": ["ტეგი"], "url": "ლინკი" }
  ]
}`,

        symptoms: `შენ ხარ მედგზურის სამედიცინო ნავიგატორი. მომხმარებელმა აღწერა სიმპტომები. ინტერნეტ ძიების შედეგების საფუძველზე, შემოთავაზე რა გამოკვლევების ჩატარება შეიძლება იყოს მიზანშეწონილი.

მნიშვნელოვანი: არ დაასახელო კონკრეტული დიაგნოზი. მხოლოდ შემოთავაზე:
1. რა ტიპის გამოკვლევები არსებობს ამ სიმპტომებისთვის
2. რომელ სპეციალისტთან შეიძლება მიმართვა
3. რა კვლევები არსებობს ამ სიმპტომატიკასთან დაკავშირებით
${grammarRules}

პასუხი მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ის გარეთ):
{
  "meta": "სიმპტომების ანალიზი",
  "summary": "ზოგადი მიმოხილვა",
  "items": [
    { "title": "რეკომენდებული გამოკვლევა/სპეციალისტი", "body": "აღწერა", "tags": ["ტეგი"] }
  ]
}`,

        clinics: `შენ ხარ მედგზურის კლინიკების ძიების ექსპერტი. მომხმარებელმა მოძებნა კლინიკები კონკრეტული მკურნალობისთვის. ინტერნეტ ძიების შედეგების საფუძველზე, შექმენი სტრუქტურირებული პასუხი ქართულ ენაზე.

პასუხი უნდა მოიცავდეს:
1. რეკომენდებული კლინიკები (სახელი, ქვეყანა, სპეციალიზაცია)
2. სავარაუდო ფასები (თუ ხელმისაწვდომია)
3. მკურნალობის ტექნოლოგიები
4. საკონტაქტო ინფორმაცია ან ვებსაიტი
${grammarRules}

პასუხი მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ისაგ გარეთ):
{
  "meta": "ნაპოვნია X კლინიკა Y ქვეყანაში",
  "items": [
    { "title": "კლინიკის სახელი", "source": "ქვეყანა", "body": "აღწერა, ფასი, ტექნოლოგია", "tags": ["ტეგი"], "url": "ვებსაიტი" }
  ]
}`
    };

    const searchSection = searchResults?.text
        ? `\nინტერნეტ ძიების შედეგები:\n${searchResults.text}`
        : '\n⚠ ინტერნეტ ძიება ვერ შესრულდა. გთხოვთ მიაწოდოთ ინფორმაცია თქვენი ცოდნის საფუძველზე და აღნიშნოვ, რომ შედეგები ვერ დადასტურდა ონლაინ წყაროებით. items მასივი არ უნდა იყოს ცარიელი — მიაწოდეთ საუკეთესო ცოდნა.';
    const citationSection = searchResults?.citations?.length
        ? `\nწყაროები: ${searchResults.citations.join(', ')}`
        : '';

    const userMessage = `ძიების მოთხოვნა: ${query}
კონტექსტი: ${JSON.stringify(context)}${searchSection}${citationSection}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250514',
                max_tokens: 3000,
                system: systemPrompts[role] || systemPrompts.research,
                messages: [{ role: 'user', content: userMessage }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Claude error:', response.status, errorBody);
            if (searchResults?.text) {
                return await formatRawResults(role, query, searchResults);
            }
            // Fallback to demo data instead of throwing
            return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        // Try to parse JSON from response
        const parsed = extractJSON(text);
        if (parsed && parsed.items && parsed.items.length > 0) {
            // Validate Georgian content — check if at least 60% of items have Georgian text
            const georgianRegex = /[\u10A0-\u10FF\u2D00-\u2D2F]/;
            const georgianItems = parsed.items.filter(item =>
                georgianRegex.test(item.title || '') || georgianRegex.test(item.body || '')
            );
            const georgianRatio = georgianItems.length / parsed.items.length;

            if (georgianRatio < 0.5) {
                console.warn(`[MedGzuri] Low Georgian ratio: ${(georgianRatio * 100).toFixed(0)}% — attempting translation fix`);
                // Items are mostly English — request Georgian translation with its own timeout
                const fixController = new AbortController();
                const fixTimeoutId = setTimeout(() => fixController.abort(), 30000);
                try {
                    const fixResponse = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'claude-sonnet-4-5-20250514',
                            max_tokens: 3000,
                            messages: [{
                                role: 'user',
                                content: `თარგმნე ეს JSON ქართულ ენაზე. ყველა title, body, source, tags ველი უნდა იყოს ქართულად. URL-ები არ შეცვალო. დააბრუნე მხოლოდ JSON, სხვა ტექსტი არ დაწერო.\n\n${JSON.stringify(parsed)}`
                            }]
                        }),
                        signal: fixController.signal
                    });
                    clearTimeout(fixTimeoutId);
                    if (fixResponse.ok) {
                        const fixResult = await fixResponse.json();
                        const fixText = fixResult.content?.[0]?.text || '';
                        const fixParsed = extractJSON(fixText);
                        if (fixParsed && fixParsed.items && fixParsed.items.length > 0) {
                            console.log('[MedGzuri] Georgian translation fix succeeded');
                            return fixParsed;
                        }
                    }
                } catch (fixErr) {
                    clearTimeout(fixTimeoutId);
                    console.error('[MedGzuri] Georgian fix failed:', fixErr.message);
                }
            }
            return parsed;
        }

        // Claude responded but not in valid JSON — try to use the text as Georgian content
        if (text.length > 50) {
            // Check if text contains Georgian characters
            const hasGeorgian = /[\u10A0-\u10FF]/.test(text);
            return {
                meta: 'ძიების შედეგები',
                items: [{
                    title: query || 'სამედიცინო ინფორმაცია',
                    body: hasGeorgian ? text : 'ძიების შედეგები დამუშავდა, მაგრამ ფორმატირება ვერ მოხერხდა. გთხოვთ სცადოთ თავიდან.',
                    tags: ['ძიება']
                }],
                summary: hasGeorgian ? undefined : text
            };
        }

        return {
            meta: 'ძიების შედეგები (არასტრუქტურირებული)',
            summary: text,
            items: []
        };

    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] Claude request timed out (45s)');
        } else {
            console.error('[MedGzuri] Claude request failed:', err.message);
        }
        if (searchResults?.text) {
            return await formatRawResults(role, query, searchResults);
        }
        // Fallback to demo data instead of throwing
        return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
    }
}

// ═══════════════ N8N PROXY ═══════════════
/**
 * Proxy a search request to the n8n multi-agent workflow.
 *
 * Returns null if n8n is not configured, if the type is unsupported,
 * or if the request fails/times out (30s). The caller falls back to
 * the direct Perplexity+Claude pipeline.
 *
 * @param {string} type - Search type
 * @param {object} data - Search parameters
 * @returns {Promise<object|null>} Structured result or null
 */
async function proxyToN8n(type, data) {
    if (!N8N_WEBHOOK_BASE_URL) return null;

    const webhookPaths = {
        research: '/research',
        symptoms: '/symptoms',
        clinics: '/clinics'
    };

    if (!webhookPaths[type]) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(`${N8N_WEBHOOK_BASE_URL}${webhookPaths[type]}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': N8N_WEBHOOK_SECRET || ''
            },
            body: JSON.stringify({ type, data }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[MedGzuri] n8n webhook error: ${response.status}`);
            return null;
        }

        const result = await response.json();
        return ensureBackwardCompat(result);
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] n8n proxy timed out (30s)');
        } else {
            console.error('[MedGzuri] n8n proxy failed:', err.message);
        }
        return null;
    }
}

/**
 * Normalize n8n response to match the frontend's expected format.
 * Converts sections-based responses to flat items[] when needed.
 *
 * @param {object} result - Raw n8n response
 * @returns {object} Normalized result
 */
function ensureBackwardCompat(result) {
    if (result.sections && (!result.items || result.items.length === 0)) {
        result.items = result.sections.flatMap(s => s.items || []);
    }
    if (!result.meta) {
        result.meta = 'ძიების შედეგები';
    }
    return result;
}

// ═══════════════ JSON EXTRACTION ═══════════════
/**
 * Extract a valid JSON object from potentially messy LLM output.
 *
 * Uses three strategies in order of likelihood:
 *   1. Code fence (```json { ... } ```) — most structured responses
 *   2. Full text as JSON                — when LLM returns pure JSON
 *   3. Balanced-brace extraction        — when LLM wraps JSON in prose
 *
 * Validates that the parsed object contains expected keys (items/meta/summary/sections).
 *
 * Performance note (Strategy 3): Previous version called JSON.parse() at every
 * depth-0 closing brace, making it O(n * k) where k = number of top-level `}`.
 * Now it only parses the FIRST complete balanced object, then stops — O(n) scan
 * + one parse attempt. If the first candidate fails, it continues to the next.
 *
 * @param {string} text - Raw LLM response text
 * @returns {object|null} Parsed JSON object, or null if extraction fails
 */
function extractJSON(text) {
    // Strategy 1: Try code fence (```json ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
        const result = tryParseValid(fenceMatch[1]);
        if (result) return result;
    }

    // Strategy 2: Try full text as JSON (avoid regex overhead)
    const trimmed = text.trim();
    if (trimmed.charCodeAt(0) === 123) { // '{' char code — faster than startsWith
        const result = tryParseValid(trimmed);
        if (result) return result;
    }

    // Strategy 3: Balanced braces extraction — single O(n) scan
    let searchFrom = 0;
    while (searchFrom < text.length) {
        const startIdx = text.indexOf('{', searchFrom);
        if (startIdx === -1) break;

        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = text.substring(startIdx, i + 1);
                    const result = tryParseValid(candidate);
                    if (result) return result;
                    // This candidate wasn't valid — search for next '{' after this block
                    searchFrom = i + 1;
                    break;
                }
            }
        }
        // If we exit the loop without depth reaching 0, no more valid JSON
        if (depth !== 0) break;
    }

    return null;
}

/**
 * Attempt to parse a string as JSON and validate it has expected MedGzuri keys.
 *
 * @param {string} str - JSON candidate string
 * @returns {object|null} Parsed object if valid, null otherwise
 */
function tryParseValid(str) {
    try {
        const parsed = JSON.parse(str);
        if (parsed && (parsed.items || parsed.meta || parsed.summary || parsed.sections)) {
            return parsed;
        }
    } catch { /* not valid JSON */ }
    return null;
}

// ═══════════════ HELPERS ═══════════════
/**
 * Build a natural-language search query for the Perplexity research endpoint.
 *
 * @param {string} diagnosis    - Medical condition or diagnosis
 * @param {string} ageGroup     - Patient age group (e.g., "adult", "pediatric")
 * @param {string} researchType - Filter: clinical_trial, systematic_review, etc.
 * @param {string} context      - Additional free-text context
 * @returns {string} Constructed search query
 */
function buildResearchQuery(diagnosis, ageGroup, researchType, context) {
    let query = `Latest medical research, clinical trials, and treatment options for ${diagnosis}.`;
    if (ageGroup) query += ` Patient age group: ${ageGroup}.`;
    if (researchType && researchType !== 'all') {
        const types = {
            clinical_trial: 'clinical trials',
            systematic_review: 'systematic reviews',
            case_study: 'case studies',
            meta_analysis: 'meta-analyses'
        };
        query += ` Focus on ${types[researchType] || researchType}.`;
    }
    if (context) query += ` Additional context: ${context}`;
    return query;
}

// ═══════════════ FORMAT RAW RESULTS ═══════════════
/**
 * Wrap raw Perplexity text into the standard MedGzuri response format.
 * Used as a fallback when Claude is unavailable.
 *
 * @param {string} role          - Search role (unused, kept for signature consistency)
 * @param {string} query         - Original search query
 * @param {object} searchResults - Raw Perplexity results { text, citations }
 * @returns {Promise<object>} Formatted result
 */
async function formatRawResults(role, query, searchResults) {
    return {
        meta: 'ძიების შედეგები',
        items: [{
            title: query || 'სამედიცინო ინფორმაცია',
            body: searchResults.text || '',
            tags: ['ძიება'],
            source: 'Perplexity AI'
        }],
        _rawFallback: true
    };
}

// ═══════════════ DEMO DATA ═══════════════
/**
 * Return static Georgian mock data for demo/development mode.
 * Activated when no API keys are configured.
 *
 * @param {string} type - Search type (research|symptoms|clinics)
 * @param {object} data - Search parameters (used for context in future)
 * @returns {object} Demo result in standard MedGzuri response format
 */
function getDemoResult(type, data) {
    if (type === 'research') {
        return {
            meta: 'ნაპოვნია 3 კვლევა (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'უახლესი კვლევები',
                    source: 'PubMed / ClinicalTrials.gov',
                    body: 'ეს არის სადემონსტრაციო შედეგი. რეალური ძიებისთვის საჭიროა API კონფიგურაცია.\n\nPubMed-ის მონაცემთა ბაზა მოიცავს 38 მილიონზე მეტ სამედიცინო კვლევას. ჩვენი სისტემა ახდენს მათ ანალიზს და თარგმნის ქართულად.',
                    tags: ['კვლევა', 'PubMed'],
                    url: 'https://pubmed.ncbi.nlm.nih.gov/'
                },
                {
                    title: 'კლინიკური კვლევები',
                    source: 'ClinicalTrials.gov',
                    body: 'აქტიური კლინიკური კვლევების ძიება ხელმისაწვდომია. კლინიკური კვლევები წარმოადგენს ახალი მკურნალობის მეთოდების შემოწმების საშუალებას.\n\nრეგისტრაცია კლინიკურ კვლევაში შეიძლება იყოს ალტერნატიული გზა მკურნალობისთვის.',
                    tags: ['კლინიკური კვლევა', 'მკურნალობა'],
                    url: 'https://clinicaltrials.gov/'
                },
                {
                    title: 'მკურნალობის მიმოხილვა',
                    source: 'სამედიცინო ლიტერატურა',
                    body: 'სტანდარტული და ინოვაციური მკურნალობის მეთოდების მიმოხილვა. მოიცავს ფარმაკოლოგიურ და არაფარმაკოლოგიურ მიდგომებს.\n\nრეკომენდირებულია ყველა ინფორმაციის განხილვა თქვენს ექიმთან.',
                    tags: ['მკურნალობა', 'მიმოხილვა']
                }
            ]
        };
    }

    if (type === 'symptoms') {
        return {
            meta: 'სიმპტომების ანალიზი (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'რეკომენდებული გამოკვლევები',
                    body: 'ეს არის სადემონსტრაციო შედეგი. რეალური ანალიზისთვის საჭიროა სისტემის სრული კონფიგურაცია.\n\nაღწერილი სიმპტომების საფუძველზე, შეიძლება მიზანშეწონილი იყოს შემდეგი გამოკვლევების განხილვა თქვენს ექიმთან ერთად:\n• სრული სისხლის ანალიზი\n• ბიოქიმიური ანალიზი\n• სპეციფიკური მარკერები დიაგნოზის მიხედვით',
                    tags: ['გამოკვლევა', 'ლაბორატორია']
                },
                {
                    title: 'სპეციალისტთან კონსულტაცია',
                    body: 'აღწერილი სიმპტომატიკით შეიძლება საჭირო გახდეს შესაბამისი სპეციალისტის კონსულტაცია. თქვენი ოჯახის ექიმი განსაზღვრავს ოპტიმალურ მიმართულებას.',
                    tags: ['სპეციალისტი', 'კონსულტაცია']
                }
            ]
        };
    }

    if (type === 'clinics') {
        return {
            meta: 'ნაპოვნია 3 კლინიკა (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'Charit\u00e9 University Hospital',
                    source: 'გერმანია, ბერლინი',
                    body: 'ევროპის ერთ-ერთი წამყვანი უნივერსიტეტის საავადმყოფო (სადემონსტრაციო). 100+ კლინიკა და ინსტიტუტი. საერთაშორისო პაციენტების ოფისი ხელმისაწვდომია.\n\nსავარაუდო ფასი: ინდივიდუალური შეფასება\nენა: ინგლისური, გერმანული',
                    tags: ['გერმანია', 'უნივერსიტეტის კლინიკა', 'ევროპის წამყვანი'],
                    url: 'https://www.charite.de/en/'
                },
                {
                    title: 'Memorial Healthcare Group',
                    source: 'თურქეთი, ისტანბული',
                    body: 'თურქეთის წამყვანი კერძო ჰოსპიტალური ქსელი (სადემონსტრაციო). საერთაშორისო აკრედიტაცია. რუსულენოვანი პერსონალი ხელმისაწვდომია.\n\nსავარაუდო ფასი: გერმანიაზე 40-60% ნაკლები\nენა: ინგლისური, თურქული, რუსული',
                    tags: ['თურქეთი', 'აკრედიტებული', 'საერთაშორისო'],
                    url: 'https://www.memorial.com.tr/en/'
                },
                {
                    title: 'Sheba Medical Center',
                    source: 'ისრაელი, რამატ განი',
                    body: 'ისრაელის უმსხვილესი სამედიცინო ცენტრი (სადემონსტრაციო). მსოფლიოს წამყვან საავადმყოფოთა რიცხვში. ინოვაციური მკურნალობის მეთოდები.\n\nსავარაუდო ფასი: პრემიუმ სეგმენტი\nენა: ინგლისური, ებრაული',
                    tags: ['ისრაელი', 'მსოფლიო წამყვანი', 'ინოვაცია'],
                    url: 'https://www.shebaonline.org/'
                }
            ]
        };
    }

    return { meta: 'სადემონსტრაციო რეჟიმი', items: [] };
}
