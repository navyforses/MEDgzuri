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

        // Check API keys
        if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
            // Demo mode - return mock data for testing
            console.log('[MedGzuri] No API keys configured, returning demo data');
            const demoResult = getDemoResult(type, data);
            demoResult.isDemo = true;
            return res.status(200).json(demoResult);
        }

        // Build search pipeline based on type
        let result;
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
            default:
                return res.status(400).json({ error: 'Invalid search type' });
        }

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
            console.error('[MedGzuri] Perplexity error:', response.status);
            return null;
        }

        const result = await response.json();
        return {
            text: result.choices?.[0]?.message?.content || '',
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

    const systemPrompts = {
        research: `შენ ხარ მედგზურის სამედიცინო კვლევის ექსპერტი. მომხმარებელმა მოგაწოდა დიაგნოზი და სამედიცინო კონტექსტი. ინტერნეტ ძიების შედეგების საფუძველზე, შექმენი სტრუქტურირებული პასუხი ქართულ ენაზე.

პასუხი უნდა მოიცავდეს:
1. დაავადების მოკლე მიმოხილვა
2. უახლესი კვლევები (სათაური, წყარო, ძირითადი მიგნებები)
3. აქტიური კლინიკური კვლევები (თუ არსებობს)
4. მკურნალობის ვარიანტები (სტანდარტული და ექსპერიმენტული)
5. რეკომენდაცია შემდეგი ნაბიჯებისთვის

პასუხი უნდა იყოს JSON ფორმატში:
{
  "meta": "ნაპოვნია X კვლევა, Y კლინიკური კვლევა",
  "items": [
    { "title": "სათაური", "source": "წყარო", "body": "აღწერა", "tags": ["tag1"], "url": "ლინკი" }
  ]
}`,

        symptoms: `შენ ხარ მედგზურის სამედიცინო ნავიგატორი. მომხმარებელმა აღწერა სიმპტომები. ინტერნეტ ძიების შედეგების საფუძველზე, შემოთავაზე რა გამოკვლევების ჩატარება შეიძლება იყოს მიზანშეწონილი.

მნიშვნელოვანი: არ დაასახელო კონკრეტული დიაგნოზი. მხოლოდ შემოთავაზე:
1. რა ტიპის გამოკვლევები არსებობს ამ სიმპტომებისთვის
2. რომელ სპეციალისტთან შეიძლება მიმართვა
3. რა კვლევები არსებობს ამ სიმპტომატიკასთან დაკავშირებით

პასუხი JSON ფორმატში:
{
  "meta": "სიმპტომების ანალიზი",
  "summary": "ზოგადი მიმოხილვა",
  "items": [
    { "title": "რეკომენდებული გამოკვლევა/სპეციალისტი", "body": "აღწერა", "tags": ["tag1"] }
  ]
}`,

        clinics: `შენ ხარ მედგზურის კლინიკების ძიების ექსპერტი. მომხმარებელმა მოძებნა კლინიკები კონკრეტული მკურნალობისთვის. ინტერნეტ ძიების შედეგების საფუძველზე, შექმენი სტრუქტურირებული პასუხი ქართულ ენაზე.

პასუხი უნდა მოიცავდეს:
1. რეკომენდებული კლინიკები (სახელი, ქვეყანა, სპეციალიზაცია)
2. სავარაუდო ფასები (თუ ხელმისაწვდომია)
3. მკურნალობის ტექნოლოგიები
4. საკონტაქტო ინფორმაცია ან ვებსაიტი

პასუხი JSON ფორმატში:
{
  "meta": "ნაპოვნია X კლინიკა Y ქვეყანაში",
  "items": [
    { "title": "კლინიკის სახელი", "source": "ქვეყანა", "body": "აღწერა, ფასი, ტექნოლოგია", "tags": ["tag1"], "url": "ვებსაიტი" }
  ]
}`
    };

    const userMessage = `ძიების მოთხოვნა: ${query}
კონტექსტი: ${JSON.stringify(context)}
${searchResults?.text ? `\nინტერნეტ ძიების შედეგები:\n${searchResults.text}` : ''}
${searchResults?.citations?.length ? `\nწყაროები: ${searchResults.citations.join(', ')}` : ''}`;

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
            console.error('[MedGzuri] Claude error:', response.status);
            if (searchResults?.text) {
                return formatRawResults(role, query, searchResults);
            }
            throw new Error('Claude API failed');
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        // Try to parse JSON from response
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            // Not valid JSON, wrap in standard format
        }

        return {
            meta: '',
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
