/**
 * MedGzuri AI Search API
 *
 * Serverless function that orchestrates multi-AI search pipeline:
 * 1. Perplexity API - Web search for medical research, clinics
 * 2. Anthropic Claude - Analysis, structuring, Georgian translation
 * 3. OpenAI GPT - Verification and fact-checking (Phase 2)
 *
 * Supports 3 search types: research, symptoms, clinics
 */

// ═══════════════ CONFIG ═══════════════
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const N8N_WEBHOOK_BASE_URL = process.env.N8N_WEBHOOK_BASE_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ═══════════════ IN-MEMORY CACHE (LRU) ═══════════════
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();

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

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    // Move to end (LRU)
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
}

function cacheSet(key, data) {
    if (cache.size >= CACHE_MAX_SIZE) {
        // Evict oldest entry
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, { data, ts: Date.now() });
}

// ═══════════════ RATE LIMITER ═══════════════
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 20; // max requests per IP per minute
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { windowStart: now, count: 1 });
        return false;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) return true;
    return false;
}

// Periodic cleanup of rate limit entries (every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// ═══════════════ SEARCH LOGGING (Supabase) ═══════════════
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
                source: source,
                client_ip: clientIp,
                created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('[MedGzuri] Search log failed:', err.message);
    }
}

// ═══════════════ HANDLER ═══════════════
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
        // Rate limiting
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        if (isRateLimited(clientIp)) {
            return res.status(429).json({ error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.' });
        }

        const { type, data } = req.body;

        if (!type || !data) {
            return res.status(400).json({ error: 'Missing type or data' });
        }

        // Input validation
        const MAX_TEXT_LENGTH = 2000;
        const textFields = [data.diagnosis, data.symptoms, data.context, data.notes,
                            data.existingConditions, data.medications];
        for (const field of textFields) {
            if (field && typeof field === 'string' && field.length > MAX_TEXT_LENGTH) {
                return res.status(400).json({ error: 'Input too long' });
            }
        }
        if (data.age && (isNaN(data.age) || data.age < 0 || data.age > 150)) {
            return res.status(400).json({ error: 'Invalid age' });
        }

        // Validate search type
        const validTypes = ['research', 'symptoms', 'clinics', 'report'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: 'Invalid search type' });
        }

        // Check cache first (skip for reports)
        if (type !== 'report') {
            const cacheKey = getCacheKey(type, data);
            const cached = cacheGet(cacheKey);
            if (cached) {
                console.log(`[MedGzuri] Cache HIT for ${type}`);
                cached._cached = true;
                cached._pipeline = { ms: 0, source: 'cache' };
                return res.status(200).json(cached);
            }
        }

        // Check API keys
        if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
            // Demo mode - return mock data for testing
            console.log('[MedGzuri] No API keys configured, returning demo data');
            let demoResult;
            if (type === 'report') {
                demoResult = getDemoReport(data.reportType, data.searchResult);
            } else {
                demoResult = getDemoResult(type, data);
            }
            demoResult.isDemo = true;
            return res.status(200).json(demoResult);
        }

        // Pipeline tracking
        const pipelineStart = Date.now();
        const pipelineStatus = { n8n: 'skipped', perplexity: 'skipped', claude: 'skipped' };

        // Try n8n multi-agent pipeline first, fall back to direct pipeline
        let result = await proxyToN8n(type, data);
        pipelineStatus.n8n = result ? 'success' : (N8N_WEBHOOK_BASE_URL ? 'failed' : 'skipped');

        if (!result) {
            // Fallback to existing direct pipeline
            switch (type) {
                case 'research':
                    result = await searchResearch(data);
                    break;
                case 'symptoms':
                    result = await analyzeSymptoms(data);
                    break;
                case 'clinics':
                    result = await searchClinics(data);
                    break;
                case 'report':
                    result = await generateReport(data.reportType, data.searchResult);
                    break;
                default:
                    return res.status(400).json({ error: 'Invalid search type' });
            }
        }

        // Add pipeline debug info
        const pipelineMs = Date.now() - pipelineStart;
        const pipelineSource = pipelineStatus.n8n === 'success' ? 'n8n' : 'direct';
        console.log(`[MedGzuri] Pipeline completed in ${pipelineMs}ms | n8n: ${pipelineStatus.n8n} | type: ${type}`);
        result._pipeline = { ms: pipelineMs, n8n: pipelineStatus.n8n };

        // Cache the result (skip reports)
        if (type !== 'report') {
            const cacheKey = getCacheKey(type, data);
            cacheSet(cacheKey, result);
        }

        // Log search to Supabase (async, non-blocking)
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
async function searchResearch(data) {
    const { diagnosis, ageGroup, researchType, context, regions } = data;

    // Step 1: Search with Perplexity
    const searchQuery = buildResearchQuery(diagnosis, ageGroup, researchType, context);
    const searchResults = await perplexitySearch(searchQuery);

    // Step 2: Structure with Claude
    const structured = await claudeAnalyze({
        role: 'research',
        query: diagnosis,
        searchResults,
        context: { ageGroup, researchType, regions, additionalContext: context }
    });

    return structured;
}

// ═══════════════ SEARCH: SYMPTOMS ═══════════════
async function analyzeSymptoms(data) {
    const { symptoms, age, sex, existingConditions, medications } = data;

    // Step 1: Search for symptom patterns
    const searchQuery = `medical tests and examinations for symptoms: ${symptoms}. Patient age: ${age || 'not specified'}, sex: ${sex || 'not specified'}. Existing conditions: ${existingConditions || 'none'}`;
    const searchResults = await perplexitySearch(searchQuery);

    // Step 2: Analyze with Claude
    const analysis = await claudeAnalyze({
        role: 'symptoms',
        query: symptoms,
        searchResults,
        context: { age, sex, existingConditions, medications }
    });

    return analysis;
}

// ═══════════════ SEARCH: CLINICS ═══════════════
async function searchClinics(data) {
    const { diagnosis, countries, budget, language, notes } = data;

    // Step 1: Search clinics
    const countryStr = countries.length > 0 ? countries.join(', ') : 'worldwide';
    const searchQuery = `best hospitals and clinics for ${diagnosis} in ${countryStr}. Treatment options, estimated costs, patient reviews. ${budget ? `Budget range: ${budget}` : ''} ${notes || ''}`;
    const searchResults = await perplexitySearch(searchQuery);

    // Step 2: Structure with Claude
    const structured = await claudeAnalyze({
        role: 'clinics',
        query: diagnosis,
        searchResults,
        context: { countries, budget, language, notes }
    });

    return structured;
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
                content: 'წინამდებარე ანგარიში წარმოადგენს სადემონსტრაციო დოკუმენტს. რეალური ანგარიშის გენერაციისთვის საჭიროა სისტემის სრული კონფიგურაცია. ანგარიში მომზადებულია ხელმისაწვდომი სამედიცინო ლიტერატურისა და კლინიკური მონაცემების საფუძველზე.'
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
                        content: 'You are a medical research assistant. Search for the most recent, evidence-based medical information. Include specific studies, clinical trials, hospital names, and treatment details. Always cite sources with URLs when available.'
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
async function claudeAnalyze({ role, query, searchResults, context }) {
    if (!ANTHROPIC_API_KEY) {
        // Fallback: return raw search results formatted
        if (searchResults?.text) {
            return formatRawResults(role, query, searchResults);
        }
        return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
    }

    const grammarRules = `

ენობრივი მოთხოვნები:
- გამოიყენე ლიტერატურული ქართული ენა, სწორი ბრუნვები და ზმნის ფორმები
- სამედიცინო ტერმინოლოგია მხოლოდ ქართულად (არ გამოიყენო ინგლისური ფრჩხილებში)
- წინადადებები სრული და გრამატიკულად გამართული უნდა იყოს
- გამოიყენე პროფესიული სამედიცინო რეგისტრი
- თითოეულ item-ის body ველში: მინიმუმ 2-3 სრული, შინაარსიანი წინადადება`;

    const systemPrompts = {
        research: `შენ ხარ მედგზურის სამედიცინო კვლევის ექსპერტი. მომხმარებელმა მოგაწოდა დიაგნოზი და სამედიცინო კონტექსტი. ინტერნეტ ძიების შედეგების საფუძველზე, შექმენი სტრუქტურირებული პასუხი ქართულ ენაზე.

პასუხი უნდა მოიცავდეს:
1. დაავადების მოკლე მიმოხილვა
2. უახლესი კვლევები (სათაური, წყარო, ძირითადი მიგნებები)
3. აქტიური კლინიკური კვლევები (თუ არსებობს)
4. მკურნალობის ვარიანტები (სტანდარტული და ექსპერიმენტული)
5. რეკომენდაცია შემდეგი ნაბიჯებისთვის
${grammarRules}

პასუხი უნდა იყოს მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ის გარეთ):
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

პასუხი მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ის გარეთ):
{
  "meta": "ნაპოვნია X კლინიკა Y ქვეყანაში",
  "items": [
    { "title": "კლინიკის სახელი", "source": "ქვეყანა", "body": "აღწერა, ფასი, ტექნოლოგია", "tags": ["ტეგი"], "url": "ვებსაიტი" }
  ]
}`
    };

    const searchSection = searchResults?.text
        ? `\nინტერნეტ ძიების შედეგები:\n${searchResults.text}`
        : '\n⚠ ინტერნეტ ძიება ვერ შესრულდა. გთხოვთ მიაწოდოთ ინფორმაცია თქვენი ცოდნის საფუძველზე და აღნიშნოთ, რომ შედეგები ვერ დადასტურდა ონლაინ წყაროებით. items მასივი არ უნდა იყოს ცარიელი — მიაწოდეთ საუკეთესო ცოდნა.';
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
                return formatRawResults(role, query, searchResults);
            }
            throw new Error('Claude API failed');
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        // Try to parse JSON from response
        const parsed = extractJSON(text);
        if (parsed) {
            return parsed;
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
            return formatRawResults(role, query, searchResults);
        }
        throw err;
    }
}

// ═══════════════ N8N PROXY ═══════════════
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
function extractJSON(text) {
    // Strategy 1: Try code fence (```json ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
        try {
            const parsed = JSON.parse(fenceMatch[1]);
            if (parsed.items || parsed.meta || parsed.summary) return parsed;
        } catch (e) { /* try next strategy */ }
    }

    // Strategy 2: Try full text as JSON
    try {
        const trimmed = text.trim();
        if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed);
            if (parsed.items || parsed.meta || parsed.summary) return parsed;
        }
    } catch (e) { /* try next strategy */ }

    // Strategy 3: Balanced braces extraction
    const startIdx = text.indexOf('{');
    if (startIdx !== -1) {
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
                    try {
                        const candidate = text.substring(startIdx, i + 1);
                        const parsed = JSON.parse(candidate);
                        if (parsed.items || parsed.meta || parsed.summary) return parsed;
                    } catch (e) { /* continue searching */ }
                }
            }
        }
    }

    return null;
}

// ═══════════════ HELPERS ═══════════════
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
    query += ' Include PubMed references, ClinicalTrials.gov entries, and recent publications from 2023-2025.';
    return query;
}

function formatRawResults(role, query, searchResults) {
    const text = searchResults.text || '';
    const paragraphs = text.split('\n').filter(p => p.trim().length > 20);

    return {
        meta: `ძიების შედეგები`,
        items: paragraphs.slice(0, 5).map((p, i) => ({
            title: `შედეგი ${i + 1}`,
            body: p.trim(),
            tags: ['ძიება']
        })),
        summary: paragraphs.length === 0 ? text : undefined
    };
}

// ═══════════════ DEMO DATA ═══════════════
function getDemoResult(type, data) {
    const diagnosis = data?.diagnosis || data?.symptoms || 'სამედიცინო მოთხოვნა';

    if (type === 'research') {
        return {
            meta: `ნაპოვნია 3 კვლევა "${diagnosis}"-ის შესახებ (სადემონსტრაციო რეჟიმი)`,
            items: [
                {
                    title: 'თანამედროვე მიდგომები მკურნალობაში — სისტემატური მიმოხილვა (2024)',
                    source: 'საერთაშორისო სამედიცინო ბაზა',
                    body: 'ეს არის სადემონსტრაციო შედეგი. რეალური ძიებისთვის საჭიროა სისტემის სრული კონფიგურაცია. კვლევა მიმოიხილავს უახლეს თერაპიულ მიდგომებს და კლინიკურ შედეგებს.\n\nZhang et al. (2024) ავტორების მიერ ჩატარებული ანალიზი მოიცავს 15 შემთხვევითი შერჩევის კონტროლირებულ კვლევას.',
                    tags: ['სისტემატური მიმოხილვა', '2024', 'მაღალი მტკიცებულება'],
                    url: 'https://pubmed.ncbi.nlm.nih.gov/'
                },
                {
                    title: 'III ფაზის კლინიკური კვლევა — ახალი თერაპიული მიდგომა',
                    source: 'კლინიკურ კვლევათა რეესტრი',
                    body: 'მრავალცენტრიანი, შემთხვევითი შერჩევის კვლევა (სადემონსტრაციო). აქტიურ ფაზაშია, ჩართულია 250 პაციენტი 12 ცენტრიდან ევროპასა და აშშ-ში.\n\nპირველადი შეფასების კრიტერიუმი: პროგრესიის გარეშე გადარჩენა. მეორადი: საერთო გადარჩენა, ცხოვრების ხარისხი.',
                    tags: ['კლინიკური კვლევა', 'III ფაზა', 'მიმდინარე ჩარიცხვა'],
                    url: 'https://clinicaltrials.gov/'
                },
                {
                    title: 'ახალი ბიომარკერების იდენტიფიკაცია — წინაკლინიკური კვლევა',
                    source: 'წინასწარი გამოქვეყნება',
                    body: 'წინასწარი პუბლიკაცია (სადემონსტრაციო). მკვლევართა ჯგუფმა გამოავლინა ახალი ბიომარკერები, რომლებიც შეიძლება გამოყენებულ იქნას ადრეული დიაგნოსტიკისთვის და ინდივიდუალური მკურნალობის დაგეგმვისთვის.',
                    tags: ['წინასწარი პუბლიკაცია', 'ბიომარკერები', '2025']
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
