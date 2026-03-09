/**
 * MedGzuri QA Audit API — 9 Specialized Quality Teams
 *
 * ხარისხის უზრუნველყოფის გუნდები:
 *   1. API პაიპლაინი    — სამედიცინო ძიების პასუხების აუდიტი
 *   2. ვიზუალური        — CSS მთლიანობა, სტილები, ფონტები
 *   3. UX/ნავიგაცია     — ფორმები, ტაბები, ბმულები, სტრუქტურა
 *   4. უსაფრთხოება      — XSS, ვალიდაცია, CORS, ინექციები
 *   5. კონტენტი         — ქართული ენა, სამედიცინო უსაფრთხოება
 *   6. წარმადობა        — ფაილების ზომა, რესურსები, CDN
 *   7. SEO              — მეტა-ტეგები, სემანტიკა, ხელმისაწვდომობა
 *   8. ჩატბოტი          — ცოდნის ბაზა, პასუხების ხარისხი
 *   9. ინტეგრაცია       — n8n, Supabase, Vercel, API routing
 *
 * Actions:
 *   POST { action: "teams" }                    — list teams & competencies
 *   POST { action: "health" }                   — quick system health
 *   POST { action: "audit" }                    — full audit (all 9 teams)
 *   POST { action: "audit-team", team: "..." }  — run one team
 *   POST { action: "audit-single", type, data } — API pipeline single query
 */

const fs = require('fs');
const path = require('path');

// ═══════════════ CONFIG ═══════════════

const ROOT = path.join(__dirname, '..');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEORGIAN_REGEX = /[\u10A0-\u10FF]/g;

const DIAGNOSIS_PATTERNS = [
    /თქვენ გაქვთ/i, /თქვენი დიაგნოზი/i, /დიაგნოზია/i,
    /you have been diagnosed/i, /your diagnosis is/i, /you are suffering from/i
];

const API_TEST_CASES = {
    research: {
        label: 'კვლევების ძიება',
        data: { diagnosis: 'ტიპი 2 დიაბეტი', ageGroup: 'adult', researchType: 'all', context: '', regions: ['global'] }
    },
    symptoms: {
        label: 'სიმპტომების ნავიგაცია',
        data: { symptoms: 'თავის ტკივილი, გულისრევა, მხედველობის დარღვევა', age: 35, sex: 'male', existingConditions: '', medications: '' }
    },
    clinics: {
        label: 'კლინიკების ძიება',
        data: { diagnosis: 'მუხლის ენდოპროთეზირება', countries: ['germany', 'turkey'], budget: 'mid', language: 'english', notes: '' }
    }
};

const SITE_PAGES = ['index.html', 'product.html', 'login.html', 'admin.html', 'crm.html', 'qa.html'];

// ═══════════════ TEAM REGISTRY ═══════════════

const TEAMS = {
    'api-pipeline': {
        id: 'api-pipeline',
        name: 'API პაიპლაინის გუნდი',
        icon: '🔬',
        weight: 20,
        competencies: [
            'სამედიცინო ძიების API-ის ტესტირება (research, symptoms, clinics)',
            'პასუხის სტრუქტურის ვალიდაცია (meta, items, sections)',
            'HTTP სტატუს კოდების შემოწმება',
            'პასუხის დროის მონიტორინგი',
            'დემო/პროდაქშენ რეჟიმის დეტექცია',
            'n8n პაიპლაინის სტატუსის შემოწმება',
            'კეშირების მექანიზმის ტესტირება'
        ],
        run: runApiPipelineTeam
    },
    'visual': {
        id: 'visual',
        name: 'ვიზუალური მთლიანობის გუნდი',
        icon: '🎨',
        weight: 15,
        competencies: [
            'CSS კორუფციის დეტექცია (ბინარული სიმბოლოები სტილებში)',
            'კრიტიკული CSS სელექტორების არსებობის შემოწმება',
            'ფონტების ჩატვირთვის ვერიფიკაცია (Noto Sans Georgian)',
            'CSS ცვლადების თანმიმდევრულობა',
            'display:none ელემენტების სწორი კონფიგურაცია',
            'ანიმაციების და @keyframes დეფინიციები'
        ],
        run: runVisualTeam
    },
    'ux': {
        id: 'ux',
        name: 'UX/ნავიგაციის გუნდი',
        icon: '🧭',
        weight: 12,
        competencies: [
            'ნავიგაციის ბმულების თანმიმდევრულობა ყველა გვერდზე',
            'ფორმების ველების ვალიდაცია (labels, placeholders)',
            'ინტერაქტიული ელემენტების მოვლენების ჰენდლერები',
            'ტაბ-ნავიგაციის ფუნქციონალობა (product.html)',
            'მობილური ადაპტიურობა (viewport, media queries)',
            'გვერდების სტრუქტურული მთლიანობა (DOCTYPE, html, head, body)'
        ],
        run: runUxTeam
    },
    'security': {
        id: 'security',
        name: 'უსაფრთხოების გუნდი',
        icon: '🛡️',
        weight: 15,
        competencies: [
            'XSS პრევენცია — escapeHtml() ფუნქციის არსებობა',
            'DOMPurify ბიბლიოთეკის ჩატვირთვა (product.html)',
            'innerHTML-ის უსაფრთხო გამოყენება',
            'API-ში შეყვანის ვალიდაცია (სიგრძე, ტიპი)',
            'CORS ჰედერების კონფიგურაცია',
            'API კლავიშების დაცვა (არ ჩანს კლიენტის კოდში)',
            'rate limiting მექანიზმის არსებობა'
        ],
        run: runSecurityTeam
    },
    'content': {
        id: 'content',
        name: 'კონტენტის ხარისხის გუნდი',
        icon: '📝',
        weight: 15,
        competencies: [
            'ქართული ენის რაოდენობრივი ანალიზი API პასუხებში',
            'სამედიცინო უსაფრთხოების შემოწმება (დიაგნოზის ენის აკრძალვა)',
            'სამედიცინო დისქლეიმერების არსებობა',
            'პასუხის სისრულე (title, body, tags, source)',
            'მონაცემთა ინტეგრაცია (კორუფციის, undefined-ის დეტექცია)',
            'URL-ების ვალიდაცია'
        ],
        run: runContentTeam
    },
    'performance': {
        id: 'performance',
        name: 'წარმადობის გუნდი',
        icon: '⚡',
        weight: 8,
        competencies: [
            'HTML ფაილების ზომის ოპტიმიზაცია',
            'გარე რესურსების რაოდენობა და ჩატვირთვის სტრატეგია (defer/async)',
            'ინლაინ CSS/JS ზომის ანალიზი',
            'CDN რესურსების აუდიტი',
            'Serverless ფუნქციების ზომა',
            'DNS prefetch/preconnect კონფიგურაცია'
        ],
        run: runPerformanceTeam
    },
    'seo': {
        id: 'seo',
        name: 'SEO/ხელმისაწვდომობის გუნდი',
        icon: '🔍',
        weight: 8,
        competencies: [
            'title ტეგების არსებობა და უნიკალურობა',
            'meta description ტეგები',
            'Open Graph და Twitter Card ტეგები',
            'lang="ka" ატრიბუტი',
            'სემანტიკური HTML სტრუქტურა (h1-h6 იერარქია)',
            'Canonical URLs და sitemap',
            'charset="UTF-8" დეკლარაცია'
        ],
        run: runSeoTeam
    },
    'chatbot': {
        id: 'chatbot',
        name: 'ჩატბოტის გუნდი',
        icon: '🤖',
        weight: 5,
        competencies: [
            'ცოდნის ბაზის კატეგორიების რაოდენობა',
            'საკვანძო სიტყვების დაფარვა',
            'პასუხების ქართული ენის ხარისხი',
            'სამედიცინო დისქლეიმერი medicalAdvice კატეგორიაში',
            'default fallback პასუხის არსებობა',
            'escapeHtml XSS პრევენცია ჩატბოტში'
        ],
        run: runChatbotTeam
    },
    'integration': {
        id: 'integration',
        name: 'ინტეგრაციის გუნდი',
        icon: '🔗',
        weight: 7,
        competencies: [
            'n8n workflow ფაილების ვალიდაცია (JSON სტრუქტურა)',
            'Vercel routing კონფიგურაციის შემოწმება',
            'Environment ცვლადების სტატუსი',
            'Supabase კავშირის შემოწმება',
            'API endpoint-ების მისაწვდომობა',
            'Serverless ფუნქციების მაქსიმალური დროის კონფიგურაცია'
        ],
        run: runIntegrationTeam
    }
};

// ═══════════════ HANDLER ═══════════════

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, team, type, data } = req.body || {};

    try {
        switch (action) {
            case 'teams':
                return res.status(200).json(getTeamsList());

            case 'health':
                return res.status(200).json(await runHealthCheck(req));

            case 'audit':
                return res.status(200).json(await runFullAudit(req));

            case 'audit-team':
                if (!team || !TEAMS[team]) return res.status(400).json({ error: 'Invalid team. Use: ' + Object.keys(TEAMS).join(', ') });
                return res.status(200).json(await runTeamAudit(req, team));

            case 'audit-single':
                if (!type || !data) return res.status(400).json({ error: 'Missing type or data' });
                return res.status(200).json(await auditSingleQuery(req, type, data));

            default:
                return res.status(400).json({ error: 'Invalid action. Use: teams, health, audit, audit-team, audit-single' });
        }
    } catch (err) {
        console.error('[MedGzuri QA] Error:', err.message);
        return res.status(500).json({ error: 'QA audit failed', details: err.message });
    }
};

// ═══════════════ ACTION HANDLERS ═══════════════

function getTeamsList() {
    const teams = {};
    for (const [id, team] of Object.entries(TEAMS)) {
        teams[id] = { name: team.name, icon: team.icon, weight: team.weight, competencies: team.competencies };
    }
    return { teams, totalTeams: Object.keys(TEAMS).length };
}

async function runHealthCheck(req) {
    const checks = {
        timestamp: new Date().toISOString(),
        api: { status: 'unknown' },
        pipeline: { anthropic: 'unknown', n8n: 'unknown' },
        environment: {}
    };

    checks.environment = {
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        N8N_WEBHOOK_BASE_URL: !!process.env.N8N_WEBHOOK_BASE_URL,
        N8N_WEBHOOK_SECRET: !!process.env.N8N_WEBHOOK_SECRET,
        SUPABASE_URL: !!SUPABASE_URL
    };

    try {
        const startMs = Date.now();
        const response = await callSearchAPI(req, 'research', API_TEST_CASES.research.data);
        const elapsed = Date.now() - startMs;

        checks.api = { status: response._status === 200 ? 'ok' : 'error', responseTimeMs: elapsed, statusCode: response._status };

        if (response._pipeline) {
            checks.pipeline = {
                responseTimeMs: response._pipeline.ms || 0,
                n8n: response._pipeline.n8n || 'skipped',
                railway: response._pipeline.railway || 'skipped',
                source: response._pipeline.source || (response._pipeline.n8n === 'success' ? 'n8n' : response._pipeline.railway === 'success' ? 'railway' : 'direct')
            };
        }
        checks.isDemo = !!response.isDemo;
    } catch (err) {
        checks.api = { status: 'error', error: err.message };
    }

    checks.overallStatus = checks.api.status === 'ok' ? 'healthy' : 'degraded';
    return checks;
}

async function runFullAudit(req) {
    const auditStart = Date.now();
    const teamResults = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [id, team] of Object.entries(TEAMS)) {
        try {
            teamResults[id] = await team.run(req);
            teamResults[id].name = team.name;
            teamResults[id].icon = team.icon;
            teamResults[id].teamWeight = team.weight;
        } catch (err) {
            teamResults[id] = {
                name: team.name, icon: team.icon, teamWeight: team.weight,
                score: 0, grade: 'F', checks: {},
                error: err.message
            };
        }
        totalWeightedScore += (teamResults[id].score || 0) * team.weight;
        totalWeight += team.weight;
    }

    const overallScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
    const report = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - auditStart,
        overallScore,
        grade: scoreToGrade(overallScore),
        teamResults,
        summary: buildFullSummary(teamResults, overallScore),
        recommendations: buildFullRecommendations(teamResults)
    };

    await logAudit(report);
    return report;
}

async function runTeamAudit(req, teamId) {
    const team = TEAMS[teamId];
    const result = await team.run(req);
    result.name = team.name;
    result.icon = team.icon;
    result.teamWeight = team.weight;
    return result;
}

// ═══════════════ TEAM 1: API PIPELINE ═══════════════

async function runApiPipelineTeam(req) {
    const checks = {};
    let subResults = {};

    for (const [type, testCase] of Object.entries(API_TEST_CASES)) {
        subResults[type] = await auditSingleQuery(req, type, testCase.data);
    }

    // Aggregate sub-results
    let totalScore = 0;
    let count = 0;
    for (const [type, result] of Object.entries(subResults)) {
        checks[`api_${type}`] = {
            label: result.label,
            passed: result.score >= 60,
            value: `${result.grade} (${result.score}/100)`,
            weight: 10,
            details: result.isDemo ? 'დემო რეჟიმი' : 'პროდაქშენ',
            subChecks: result.checks
        };
        totalScore += result.score;
        count++;
    }

    const score = count > 0 ? Math.round(totalScore / count) : 0;
    return { score, grade: scoreToGrade(score), checks, subResults };
}

async function auditSingleQuery(req, type, data) {
    const startMs = Date.now();
    let response;
    try {
        response = await callSearchAPI(req, type, data);
    } catch (err) {
        return {
            type, label: API_TEST_CASES[type]?.label || type,
            score: 0, grade: 'F', weight: 1, responseTimeMs: Date.now() - startMs,
            error: err.message, checks: {}
        };
    }

    const elapsed = Date.now() - startMs;
    const checks = {};

    // HTTP Status
    checks.httpStatus = { label: 'HTTP სტატუსი', passed: response._status === 200, value: response._status, expected: 200, weight: 15 };

    // Structure
    checks.structure = validateStructure(response, type);

    // Georgian Language
    checks.georgianLanguage = validateGeorgian(response);

    // Medical Safety
    checks.medicalSafety = validateMedicalSafety(response, type);

    // Completeness
    checks.completeness = validateCompleteness(response, type);

    // Response Time
    checks.responseTime = {
        label: 'პასუხის დრო', passed: elapsed < 60000,
        value: `${elapsed}ms`, expected: '<60000ms', weight: 10,
        details: elapsed < 5000 ? 'შესანიშნავი' : elapsed < 15000 ? 'კარგი' : elapsed < 30000 ? 'ნელი' : 'ძალიან ნელი'
    };

    // Data Integrity
    checks.dataIntegrity = validateDataIntegrity(response);

    let totalWeighted = 0, totalWeight = 0;
    for (const check of Object.values(checks)) {
        const w = check.weight || 10;
        totalWeighted += (check.passed ? 100 : 0) * w;
        totalWeight += w;
    }

    const score = totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;

    return {
        type, label: API_TEST_CASES[type]?.label || type,
        score, grade: scoreToGrade(score), weight: 1,
        responseTimeMs: elapsed, isDemo: !!response.isDemo,
        pipeline: response._pipeline || null, checks
    };
}

// ═══════════════ TEAM 2: VISUAL INTEGRITY ═══════════════

async function runVisualTeam() {
    const checks = {};
    const pages = loadPages();

    // Check 1: CSS corruption (binary chars in style blocks)
    let corruptedPages = [];
    const binaryPattern = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
    for (const [name, content] of Object.entries(pages)) {
        const styleBlocks = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
        for (const block of styleBlocks) {
            if (binaryPattern.test(block)) corruptedPages.push(name);
        }
    }
    checks.cssCorruption = {
        label: 'CSS კორუფციის დეტექცია',
        passed: corruptedPages.length === 0,
        value: corruptedPages.length === 0 ? 'სუფთა' : `${corruptedPages.length} კორუფცია`,
        weight: 25,
        issues: corruptedPages.length > 0 ? corruptedPages.map(p => `${p}: ბინარული სიმბოლოები CSS-ში`) : undefined
    };

    // Check 2: Critical CSS selectors in product.html
    const product = pages['product.html'] || '';
    const criticalSelectors = ['.ai-processing', '.disclaimer', '.error-message', '.result-card', '.navbar', '.form-group'];
    const missingSelectors = criticalSelectors.filter(sel => !product.includes(sel.replace('.', '')));
    checks.criticalSelectors = {
        label: 'კრიტიკული CSS სელექტორები',
        passed: missingSelectors.length === 0,
        value: `${criticalSelectors.length - missingSelectors.length}/${criticalSelectors.length}`,
        weight: 20,
        issues: missingSelectors.length > 0 ? missingSelectors.map(s => `${s} აკლია product.html-ს`) : undefined
    };

    // Check 3: Font loading
    let fontOk = 0;
    for (const [name, content] of Object.entries(pages)) {
        if (content.includes('Noto Sans Georgian')) fontOk++;
    }
    checks.fontLoading = {
        label: 'ფონტის ჩატვირთვა (Noto Sans Georgian)',
        passed: fontOk === Object.keys(pages).length,
        value: `${fontOk}/${Object.keys(pages).length} გვერდი`,
        weight: 15
    };

    // Check 4: CSS custom properties consistency
    const cssVarPages = {};
    for (const [name, content] of Object.entries(pages)) {
        const vars = content.match(/--[\w-]+/g) || [];
        cssVarPages[name] = new Set(vars);
    }
    const mainVars = ['--teal', '--navy', '--text', '--bg', '--border'];
    const productVars = cssVarPages['product.html'] || new Set();
    const varsMissing = mainVars.filter(v => !productVars.has(v));
    checks.cssVariables = {
        label: 'CSS ცვლადების თანმიმდევრულობა',
        passed: varsMissing.length === 0,
        value: varsMissing.length === 0 ? 'თანმიმდევრული' : `${varsMissing.length} აკლია`,
        weight: 10,
        issues: varsMissing.length > 0 ? varsMissing.map(v => `${v} აკლია product.html-ს`) : undefined
    };

    // Check 5: Hidden elements default state
    const hiddenByDefault = ['.ai-processing', '.status-bar', '.score-section', '.results-section'];
    const hiddenOk = hiddenByDefault.filter(sel => {
        const regex = new RegExp(sel.replace('.', '\\.') + '[^{]*\\{[^}]*display\\s*:\\s*none', 'i');
        return Object.values(pages).some(c => regex.test(c));
    });
    checks.hiddenElements = {
        label: 'display:none ნაგულისხმევი მდგომარეობა',
        passed: hiddenOk.length >= hiddenByDefault.length * 0.5,
        value: `${hiddenOk.length}/${hiddenByDefault.length}`,
        weight: 15
    };

    // Check 6: Keyframes animations
    const keyframesCount = (product.match(/@keyframes\s+\w+/g) || []).length;
    checks.animations = {
        label: 'ანიმაციების დეფინიციები',
        passed: keyframesCount >= 2,
        value: `${keyframesCount} @keyframes`,
        weight: 10,
        details: keyframesCount >= 4 ? 'სრული' : keyframesCount >= 2 ? 'საბაზისო' : 'არასაკმარისი'
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 3: UX/NAVIGATION ═══════════════

async function runUxTeam() {
    const checks = {};
    const pages = loadPages();

    // Check 1: Page structure (DOCTYPE, html, head, body)
    let structureOk = 0;
    const structureIssues = [];
    for (const [name, content] of Object.entries(pages)) {
        const has = content.includes('<!DOCTYPE html') && content.includes('<html') && content.includes('<head') && content.includes('<body');
        if (has) structureOk++;
        else structureIssues.push(`${name}: არასრული HTML სტრუქტურა`);
    }
    checks.pageStructure = {
        label: 'გვერდების HTML სტრუქტურა',
        passed: structureOk === Object.keys(pages).length,
        value: `${structureOk}/${Object.keys(pages).length}`,
        weight: 15,
        issues: structureIssues.length > 0 ? structureIssues : undefined
    };

    // Check 2: Viewport meta tag
    let viewportOk = 0;
    for (const [name, content] of Object.entries(pages)) {
        if (content.includes('viewport') && content.includes('width=device-width')) viewportOk++;
    }
    checks.viewport = {
        label: 'Viewport მეტა ტეგი',
        passed: viewportOk === Object.keys(pages).length,
        value: `${viewportOk}/${Object.keys(pages).length}`,
        weight: 15
    };

    // Check 3: Navigation links consistency
    const navLinks = {};
    for (const [name, content] of Object.entries(pages)) {
        const links = (content.match(/href="([^"]+)"/g) || []).map(m => m.match(/href="([^"]+)"/)[1]);
        navLinks[name] = links;
    }
    const productLinked = Object.values(navLinks).some(links => links.includes('/product') || links.includes('/product.html'));
    const homeLinked = Object.values(navLinks).some(links => links.includes('/') || links.includes('/index.html'));
    checks.navConsistency = {
        label: 'ნავიგაციის თანმიმდევრულობა',
        passed: productLinked && homeLinked,
        value: productLinked && homeLinked ? 'თანმიმდევრული' : 'არასრული',
        weight: 15,
        issues: [!productLinked && 'პროდუქტის ბმული აკლია', !homeLinked && 'მთავარის ბმული აკლია'].filter(Boolean)
    };
    if (checks.navConsistency.issues.length === 0) delete checks.navConsistency.issues;

    // Check 4: Forms have placeholders/labels
    const product = pages['product.html'] || '';
    const inputs = (product.match(/<input[^>]*>/gi) || []);
    const inputsWithPlaceholder = inputs.filter(inp => inp.includes('placeholder='));
    checks.formLabels = {
        label: 'ფორმების placeholder/label',
        passed: inputs.length === 0 || inputsWithPlaceholder.length >= inputs.length * 0.5,
        value: `${inputsWithPlaceholder.length}/${inputs.length} input`,
        weight: 15
    };

    // Check 5: Interactive handlers (onclick, addEventListener)
    const handlers = (product.match(/onclick|addEventListener|\.addEventListener/g) || []).length;
    checks.interactiveHandlers = {
        label: 'ინტერაქტიული ელემენტების ჰენდლერები',
        passed: handlers >= 3,
        value: `${handlers} ჰენდლერი`,
        weight: 10,
        details: handlers >= 10 ? 'სრული' : handlers >= 3 ? 'საბაზისო' : 'არასაკმარისი'
    };

    // Check 6: Media queries for responsiveness
    let mediaQueryCount = 0;
    for (const content of Object.values(pages)) {
        mediaQueryCount += (content.match(/@media/g) || []).length;
    }
    checks.responsiveness = {
        label: 'მობილური ადაპტიურობა (@media)',
        passed: mediaQueryCount >= 3,
        value: `${mediaQueryCount} @media წესი`,
        weight: 15,
        details: mediaQueryCount >= 8 ? 'შესანიშნავი' : mediaQueryCount >= 3 ? 'კარგი' : 'არასაკმარისი'
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 4: SECURITY ═══════════════

async function runSecurityTeam() {
    const checks = {};
    const pages = loadPages();

    // Check 1: escapeHtml function presence
    let escapeHtmlCount = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('escapeHtml')) escapeHtmlCount++;
    }
    checks.escapeHtml = {
        label: 'XSS: escapeHtml() ფუნქცია',
        passed: escapeHtmlCount >= 1,
        value: `${escapeHtmlCount} გვერდი`,
        weight: 20,
        details: escapeHtmlCount >= 2 ? 'კარგი დაფარვა' : escapeHtmlCount === 1 ? 'ნაწილობრივი' : 'აკლია'
    };

    // Check 2: DOMPurify in product.html
    const product = pages['product.html'] || '';
    const hasDomPurify = product.includes('DOMPurify') || product.includes('dompurify') || product.includes('purify.min.js');
    checks.domPurify = {
        label: 'DOMPurify ბიბლიოთეკა',
        passed: hasDomPurify,
        value: hasDomPurify ? 'ჩატვირთულია' : 'აკლია',
        weight: 15
    };

    // Check 3: API input validation
    let apiContent = '';
    try { apiContent = fs.readFileSync(path.join(ROOT, 'api', 'search.js'), 'utf-8'); } catch {}
    const hasLengthCheck = apiContent.includes('.length') && (apiContent.includes('> 2000') || apiContent.includes('>= 2000') || apiContent.includes('MAX_'));
    const hasTypeCheck = apiContent.includes("type === 'research'") || apiContent.includes("['research'");
    checks.inputValidation = {
        label: 'API შეყვანის ვალიდაცია',
        passed: hasLengthCheck && hasTypeCheck,
        value: [hasLengthCheck && 'სიგრძე', hasTypeCheck && 'ტიპი'].filter(Boolean).join(', ') || 'არცერთი',
        weight: 20
    };

    // Check 4: CORS headers
    const hasCors = apiContent.includes('Access-Control-Allow-Origin');
    checks.cors = {
        label: 'CORS ჰედერების კონფიგურაცია',
        passed: hasCors,
        value: hasCors ? 'კონფიგურირებული' : 'აკლია',
        weight: 15
    };

    // Check 5: No exposed API keys in HTML
    let keysExposed = false;
    const keyPatterns = [/sk-[a-zA-Z0-9]{20,}/, /pplx-[a-zA-Z0-9]{20,}/, /sbp_[a-zA-Z0-9]{20,}/];
    for (const content of Object.values(pages)) {
        for (const pattern of keyPatterns) {
            if (pattern.test(content)) { keysExposed = true; break; }
        }
    }
    checks.noExposedKeys = {
        label: 'API კლავიშების დაცვა',
        passed: !keysExposed,
        value: keysExposed ? 'გამჟღავნებულია!' : 'დაცულია',
        weight: 25
    };

    // Check 6: Rate limiting
    const hasRateLimit = apiContent.includes('rateLimit') || apiContent.includes('rate_limit') || apiContent.includes('rateLimiter') || apiContent.includes('requestCount');
    checks.rateLimiting = {
        label: 'Rate Limiting',
        passed: hasRateLimit,
        value: hasRateLimit ? 'აქტიური' : 'აკლია',
        weight: 10
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 5: CONTENT QUALITY ═══════════════

async function runContentTeam(req) {
    const checks = {};

    // Run API and validate content
    let response;
    try {
        response = await callSearchAPI(req, 'research', API_TEST_CASES.research.data);
    } catch (err) {
        return { score: 0, grade: 'F', checks: { apiCall: { label: 'API გამოძახება', passed: false, value: err.message, weight: 100 } } };
    }

    checks.georgianLanguage = validateGeorgian(response);
    checks.medicalSafety = validateMedicalSafety(response, 'research');
    checks.completeness = validateCompleteness(response, 'research');
    checks.dataIntegrity = validateDataIntegrity(response);

    // Check disclaimer in symptoms response
    let symptomsResponse;
    try {
        symptomsResponse = await callSearchAPI(req, 'symptoms', API_TEST_CASES.symptoms.data);
        checks.symptomsDisclaimer = {
            label: 'სიმპტომების დისქლეიმერი',
            passed: !!symptomsResponse.disclaimer || !!symptomsResponse.isDemo,
            value: symptomsResponse.disclaimer ? 'არსებობს' : symptomsResponse.isDemo ? 'დემო' : 'აკლია',
            weight: 15
        };
    } catch {
        checks.symptomsDisclaimer = { label: 'სიმპტომების დისქლეიმერი', passed: false, value: 'API შეცდომა', weight: 15 };
    }

    // UI Content Georgian check
    const pages = loadPages();
    const uiText = Object.values(pages).join(' ');
    const uiGeorgian = (uiText.match(GEORGIAN_REGEX) || []).length;
    const uiLatin = (uiText.match(/[a-zA-Z]/g) || []).length;
    const totalAlpha = uiGeorgian + uiLatin;
    const uiRatio = totalAlpha > 0 ? Math.round((uiGeorgian / totalAlpha) * 100) : 0;
    checks.uiGeorgian = {
        label: 'UI ტექსტის ქართული',
        passed: uiRatio >= 20,
        value: `${uiRatio}%`,
        weight: 10,
        details: uiRatio >= 40 ? 'შესანიშნავი' : uiRatio >= 20 ? 'კარგი' : 'არასაკმარისი'
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 6: PERFORMANCE ═══════════════

async function runPerformanceTeam() {
    const checks = {};
    const pages = loadPages();

    // Check 1: File sizes
    const sizes = {};
    let oversized = [];
    for (const name of SITE_PAGES) {
        try {
            const stat = fs.statSync(path.join(ROOT, name));
            sizes[name] = stat.size;
            if (stat.size > 500 * 1024) oversized.push(`${name}: ${Math.round(stat.size / 1024)}KB`);
        } catch {}
    }
    checks.fileSizes = {
        label: 'HTML ფაილების ზომა',
        passed: oversized.length === 0,
        value: oversized.length === 0 ? 'ოპტიმალური' : `${oversized.length} ზომაგადაჭარბებული`,
        weight: 20,
        issues: oversized.length > 0 ? oversized : undefined,
        details: Object.entries(sizes).map(([n, s]) => `${n}: ${Math.round(s / 1024)}KB`).join(', ')
    };

    // Check 2: External resources with defer/async
    const product = pages['product.html'] || '';
    const scripts = product.match(/<script[^>]*src=[^>]*>/gi) || [];
    const deferredScripts = scripts.filter(s => s.includes('defer') || s.includes('async'));
    checks.deferAsync = {
        label: 'გარე სკრიპტები defer/async',
        passed: scripts.length === 0 || deferredScripts.length >= scripts.length * 0.5,
        value: `${deferredScripts.length}/${scripts.length}`,
        weight: 20
    };

    // Check 3: Inline CSS/JS size
    let totalInlineCSS = 0, totalInlineJS = 0;
    for (const content of Object.values(pages)) {
        const styles = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
        styles.forEach(s => totalInlineCSS += s.length);
        const inlineScripts = content.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || [];
        inlineScripts.forEach(s => totalInlineJS += s.length);
    }
    checks.inlineSize = {
        label: 'ინლაინ CSS/JS ზომა',
        passed: totalInlineCSS < 200 * 1024 && totalInlineJS < 200 * 1024,
        value: `CSS: ${Math.round(totalInlineCSS / 1024)}KB, JS: ${Math.round(totalInlineJS / 1024)}KB`,
        weight: 15
    };

    // Check 4: CDN resources
    const cdnUrls = new Set();
    for (const content of Object.values(pages)) {
        const matches = content.match(/https?:\/\/cdn[^"'\s)]+|https?:\/\/cdnjs[^"'\s)]+/g) || [];
        matches.forEach(m => cdnUrls.add(m));
    }
    checks.cdnResources = {
        label: 'CDN რესურსები',
        passed: cdnUrls.size <= 10,
        value: `${cdnUrls.size} CDN რესურსი`,
        weight: 15
    };

    // Check 5: DNS prefetch/preconnect
    const index = pages['index.html'] || '';
    const hasPrefetch = index.includes('dns-prefetch') || index.includes('preconnect');
    checks.dnsPrefetch = {
        label: 'DNS Prefetch/Preconnect',
        passed: hasPrefetch,
        value: hasPrefetch ? 'კონფიგურირებული' : 'აკლია',
        weight: 10
    };

    // Check 6: API function sizes
    const apiFunctions = ['search.js', 'auth.js', 'leads.js', 'qa.js'];
    let apiSizeIssues = [];
    for (const fn of apiFunctions) {
        try {
            const stat = fs.statSync(path.join(ROOT, 'api', fn));
            if (stat.size > 100 * 1024) apiSizeIssues.push(`api/${fn}: ${Math.round(stat.size / 1024)}KB`);
        } catch {}
    }
    checks.apiSizes = {
        label: 'Serverless ფუნქციების ზომა',
        passed: apiSizeIssues.length === 0,
        value: apiSizeIssues.length === 0 ? 'ოპტიმალური' : `${apiSizeIssues.length} დიდი`,
        weight: 15,
        issues: apiSizeIssues.length > 0 ? apiSizeIssues : undefined
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 7: SEO/ACCESSIBILITY ═══════════════

async function runSeoTeam() {
    const checks = {};
    const pages = loadPages();

    // Check 1: Title tags
    const titles = {};
    for (const [name, content] of Object.entries(pages)) {
        const match = content.match(/<title>([^<]*)<\/title>/i);
        if (match) titles[name] = match[1];
    }
    const titlesUnique = new Set(Object.values(titles)).size === Object.values(titles).length;
    checks.titleTags = {
        label: 'Title ტეგები',
        passed: Object.keys(titles).length === Object.keys(pages).length && titlesUnique,
        value: `${Object.keys(titles).length}/${Object.keys(pages).length} (${titlesUnique ? 'უნიკალური' : 'დუბლიკატები'})`,
        weight: 20
    };

    // Check 2: Meta description
    let descCount = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('meta') && content.includes('description')) descCount++;
    }
    checks.metaDescription = {
        label: 'Meta Description',
        passed: descCount >= 2,
        value: `${descCount}/${Object.keys(pages).length}`,
        weight: 15
    };

    // Check 3: Open Graph
    let ogCount = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('og:title') || content.includes('og:description')) ogCount++;
    }
    checks.openGraph = {
        label: 'Open Graph ტეგები',
        passed: ogCount >= 2,
        value: `${ogCount} გვერდი`,
        weight: 15
    };

    // Check 4: lang="ka"
    let langOk = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('lang="ka"')) langOk++;
    }
    checks.langAttribute = {
        label: 'lang="ka" ატრიბუტი',
        passed: langOk === Object.keys(pages).length,
        value: `${langOk}/${Object.keys(pages).length}`,
        weight: 15
    };

    // Check 5: Heading hierarchy (h1 present)
    let h1Count = 0;
    for (const content of Object.values(pages)) {
        if (/<h1[\s>]/i.test(content)) h1Count++;
    }
    checks.headingHierarchy = {
        label: 'H1 სათაურები',
        passed: h1Count >= 2,
        value: `${h1Count} გვერდს აქვს H1`,
        weight: 10
    };

    // Check 6: Charset UTF-8
    let charsetOk = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('charset="UTF-8"') || content.includes("charset='UTF-8'") || content.includes('charset=UTF-8')) charsetOk++;
    }
    checks.charset = {
        label: 'charset="UTF-8"',
        passed: charsetOk === Object.keys(pages).length,
        value: `${charsetOk}/${Object.keys(pages).length}`,
        weight: 15
    };

    // Check 7: Twitter Card
    let twitterOk = 0;
    for (const content of Object.values(pages)) {
        if (content.includes('twitter:card')) twitterOk++;
    }
    checks.twitterCard = {
        label: 'Twitter Card',
        passed: twitterOk >= 1,
        value: `${twitterOk} გვერდი`,
        weight: 5
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 8: CHATBOT ═══════════════

async function runChatbotTeam() {
    const checks = {};
    let chatbotContent = '';
    try {
        chatbotContent = fs.readFileSync(path.join(ROOT, 'chatbot.js'), 'utf-8');
    } catch {
        return { score: 0, grade: 'F', checks: { fileExists: { label: 'chatbot.js ფაილი', passed: false, value: 'ვერ მოიძებნა', weight: 100 } } };
    }

    // Check 1: Knowledge base categories
    const categories = chatbotContent.match(/(\w+)\s*:\s*\{[\s\S]*?keywords\s*:/g) || [];
    checks.categories = {
        label: 'ცოდნის ბაზის კატეგორიები',
        passed: categories.length >= 10,
        value: `${categories.length} კატეგორია`,
        weight: 20,
        details: categories.length >= 12 ? 'სრული' : categories.length >= 8 ? 'კარგი' : 'არასაკმარისი'
    };

    // Check 2: Keywords coverage
    const keywordMatches = chatbotContent.match(/keywords\s*:\s*\[([^\]]+)\]/g) || [];
    let totalKeywords = 0;
    for (const match of keywordMatches) {
        const kws = match.match(/'[^']+'/g) || [];
        totalKeywords += kws.length;
    }
    checks.keywordCoverage = {
        label: 'საკვანძო სიტყვების რაოდენობა',
        passed: totalKeywords >= 30,
        value: `${totalKeywords} სიტყვა`,
        weight: 15
    };

    // Check 3: Georgian language in responses
    const responseText = chatbotContent.match(/responses\s*:\s*\[([\s\S]*?)\]/g)?.join(' ') || '';
    const georgianChars = (responseText.match(GEORGIAN_REGEX) || []).length;
    const latinChars = (responseText.match(/[a-zA-Z]/g) || []).length;
    const totalAlpha = georgianChars + latinChars;
    const ratio = totalAlpha > 0 ? Math.round((georgianChars / totalAlpha) * 100) : 0;
    checks.georgianResponses = {
        label: 'პასუხების ქართული ენა',
        passed: ratio >= 50,
        value: `${ratio}%`,
        weight: 20,
        details: ratio >= 70 ? 'შესანიშნავი' : ratio >= 50 ? 'კარგი' : 'არასაკმარისი'
    };

    // Check 4: Medical disclaimer
    const hasMedicalCategory = chatbotContent.includes('medicalAdvice');
    const hasDisclaimerText = chatbotContent.includes('არ ვართ') && chatbotContent.includes('ექიმ');
    checks.medicalDisclaimer = {
        label: 'სამედიცინო დისქლეიმერი',
        passed: hasMedicalCategory && hasDisclaimerText,
        value: hasMedicalCategory && hasDisclaimerText ? 'არსებობს' : 'არასრული',
        weight: 20
    };

    // Check 5: Default fallback
    const hasDefault = chatbotContent.includes("'default'") || chatbotContent.includes('"default"');
    checks.defaultFallback = {
        label: 'Default Fallback პასუხი',
        passed: hasDefault,
        value: hasDefault ? 'არსებობს' : 'აკლია',
        weight: 10
    };

    // Check 6: XSS prevention
    const hasEscape = chatbotContent.includes('escapeHtml') || chatbotContent.includes('textContent');
    checks.chatbotXss = {
        label: 'ჩატბოტის XSS პრევენცია',
        passed: hasEscape,
        value: hasEscape ? 'დაცულია' : 'სარისკო',
        weight: 15
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ TEAM 9: INTEGRATION ═══════════════

async function runIntegrationTeam() {
    const checks = {};

    // Check 1: n8n workflow files valid JSON
    const workflows = ['research-workflow.json', 'symptoms-workflow.json', 'clinics-workflow.json'];
    let validWorkflows = 0;
    const workflowIssues = [];
    for (const wf of workflows) {
        try {
            const content = fs.readFileSync(path.join(ROOT, 'n8n', wf), 'utf-8');
            const parsed = JSON.parse(content);
            if (parsed.nodes && parsed.connections) validWorkflows++;
            else workflowIssues.push(`${wf}: nodes/connections აკლია`);
        } catch (err) {
            workflowIssues.push(`${wf}: ${err.message.substring(0, 50)}`);
        }
    }
    checks.n8nWorkflows = {
        label: 'n8n Workflow ფაილები',
        passed: validWorkflows === workflows.length,
        value: `${validWorkflows}/${workflows.length} ვალიდური`,
        weight: 15,
        issues: workflowIssues.length > 0 ? workflowIssues : undefined
    };

    // Check 2: Vercel config
    let vercelValid = false;
    let routeCount = 0;
    try {
        const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
        vercelValid = !!vercelJson.version;
        routeCount = (vercelJson.rewrites || []).length;
    } catch {}
    checks.vercelConfig = {
        label: 'Vercel კონფიგურაცია',
        passed: vercelValid && routeCount >= 5,
        value: vercelValid ? `${routeCount} route` : 'არავალიდური',
        weight: 15
    };

    // Check 3: Environment variables
    const envVars = {
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        N8N_WEBHOOK_BASE_URL: !!process.env.N8N_WEBHOOK_BASE_URL,
        SUPABASE_URL: !!SUPABASE_URL
    };
    const configuredVars = Object.values(envVars).filter(Boolean).length;
    checks.envVars = {
        label: 'Environment ცვლადები',
        passed: configuredVars >= 2,
        value: `${configuredVars}/${Object.keys(envVars).length} კონფიგურირებული`,
        weight: 20,
        details: Object.entries(envVars).map(([k, v]) => `${k}: ${v ? '✓' : '✗'}`).join(', ')
    };

    // Check 4: API endpoints match vercel routes
    const apiFiles = ['search.js', 'auth.js', 'leads.js', 'qa.js'];
    let existingApis = 0;
    for (const fn of apiFiles) {
        try {
            fs.accessSync(path.join(ROOT, 'api', fn));
            existingApis++;
        } catch {}
    }
    checks.apiEndpoints = {
        label: 'API ფაილების არსებობა',
        passed: existingApis === apiFiles.length,
        value: `${existingApis}/${apiFiles.length}`,
        weight: 15
    };

    // Check 5: Serverless maxDuration config
    let maxDurationConfigured = false;
    try {
        const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8'));
        maxDurationConfigured = !!(vercelJson.functions && Object.keys(vercelJson.functions).length > 0);
    } catch {}
    checks.maxDuration = {
        label: 'Serverless maxDuration',
        passed: maxDurationConfigured,
        value: maxDurationConfigured ? 'კონფიგურირებული' : 'ნაგულისხმევი',
        weight: 10
    };

    // Check 6: Supabase schema
    let hasSchema = false;
    try {
        fs.accessSync(path.join(ROOT, 'db', 'schema.sql'));
        hasSchema = true;
    } catch {}
    checks.dbSchema = {
        label: 'მონაცემთა ბაზის სქემა',
        passed: hasSchema,
        value: hasSchema ? 'არსებობს' : 'აკლია',
        weight: 10
    };

    // Check 7: Supabase client library
    let hasSupabaseLib = false;
    try {
        fs.accessSync(path.join(ROOT, 'lib', 'supabase.js'));
        hasSupabaseLib = true;
    } catch {}
    checks.supabaseLib = {
        label: 'Supabase კლიენტი',
        passed: hasSupabaseLib,
        value: hasSupabaseLib ? 'არსებობს' : 'აკლია',
        weight: 10
    };

    return { score: calculateTeamScore(checks), grade: scoreToGrade(calculateTeamScore(checks)), checks };
}

// ═══════════════ CONTENT VALIDATORS (shared) ═══════════════

function validateStructure(response, type) {
    const issues = [];
    let score = 0;
    const maxScore = 5;

    if (response.meta && typeof response.meta === 'string') score++;
    else issues.push('meta ველი აკლია ან არასწორი ტიპისაა');

    if (Array.isArray(response.items)) score++;
    else if (Array.isArray(response.sections)) score++;
    else issues.push('items ან sections მასივი აკლია');

    if (response.items?.length > 0 || response.sections?.length > 0) score++;
    else issues.push('შედეგები ცარიელია');

    if (response.disclaimer || response.isDemo) score++;
    else issues.push('სამედიცინო დისქლეიმერი აკლია');

    if (response.sections) {
        const validSections = response.sections.every(s => s.title && (s.items || s.type));
        if (validSections) score++;
        else issues.push('sections ფორმატი არასწორია');
    } else {
        score += 0.5;
    }

    return {
        label: 'პასუხის სტრუქტურა', passed: score >= 3,
        value: `${score}/${maxScore}`, weight: 20,
        issues: issues.length > 0 ? issues : undefined
    };
}

function validateGeorgian(response) {
    const allText = extractAllText(response);
    if (!allText || allText.length === 0) {
        return { label: 'ქართული ენა', passed: false, value: '0%', weight: 20, issues: ['ტექსტი ვერ მოიძებნა'] };
    }

    const georgianChars = (allText.match(GEORGIAN_REGEX) || []).length;
    const latinChars = (allText.match(/[a-zA-Z]/g) || []).length;
    const totalAlpha = georgianChars + latinChars;

    if (totalAlpha === 0) {
        return { label: 'ქართული ენა', passed: false, value: '0%', weight: 20, issues: ['ალფაბეტური სიმბოლოები ვერ მოიძებნა'] };
    }

    const ratio = Math.round((georgianChars / totalAlpha) * 100);
    return {
        label: 'ქართული ენა', passed: ratio >= 40,
        value: `${ratio}%`, expected: '>=40%', weight: 20,
        details: ratio >= 70 ? 'შესანიშნავი' : ratio >= 50 ? 'კარგი' : ratio >= 40 ? 'მისაღები' : 'არასაკმარისი'
    };
}

function validateMedicalSafety(response, type) {
    const allText = extractAllText(response);
    const issues = [];

    for (const pattern of DIAGNOSIS_PATTERNS) {
        if (pattern.test(allText)) {
            issues.push(`დიაგნოზის ენა: "${allText.match(pattern)?.[0]}"`);
        }
    }

    if (!response.disclaimer && !response.isDemo && type === 'symptoms') {
        issues.push('სიმპტომების ანალიზს დისქლეიმერი აკლია');
    }

    return {
        label: 'სამედიცინო უსაფრთხოება', passed: issues.length === 0,
        value: issues.length === 0 ? 'უსაფრთხო' : `${issues.length} პრობლემა`,
        weight: 25, issues: issues.length > 0 ? issues : undefined
    };
}

function validateCompleteness(response, type) {
    const items = response.items || (response.sections || []).flatMap(s => s.items || []);
    if (items.length === 0) {
        return { label: 'სისრულე', passed: false, value: '0 ელემენტი', weight: 15, issues: ['შედეგები ცარიელია'] };
    }

    const issues = [];
    let completeItems = 0;
    for (const item of items) {
        let fields = 0;
        if (item.title && item.title.length > 3) fields++;
        if (item.body && item.body.length > 20) fields++;
        if (Array.isArray(item.tags) && item.tags.length > 0) fields++;
        if (item.source || item.url) fields++;
        if (fields >= 2) completeItems++;
    }

    const ratio = Math.round((completeItems / items.length) * 100);
    if (ratio < 100) issues.push(`${items.length - completeItems}/${items.length} ელემენტს აკლია ინფორმაცია`);

    return {
        label: 'სისრულე', passed: ratio >= 50,
        value: `${completeItems}/${items.length} სრული (${ratio}%)`,
        weight: 15, issues: issues.length > 0 ? issues : undefined
    };
}

function validateDataIntegrity(response) {
    const issues = [];
    const allText = extractAllText(response);
    const binaryPattern = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
    if (binaryPattern.test(allText)) issues.push('ბინარული სიმბოლოები აღმოჩენილია');
    if (allText.includes('undefined') || allText.includes('[object Object]')) issues.push('არასწორი მონაცემთა სერიალიზაცია');

    const items = response.items || [];
    const emptyTitles = items.filter(i => i.title === '' || i.title === null).length;
    if (emptyTitles > 0) issues.push(`${emptyTitles} ელემენტს ცარიელი სათაური აქვს`);

    const urls = items.filter(i => i.url).map(i => i.url);
    for (const url of urls) {
        try { new URL(url); } catch { issues.push(`არასწორი URL: ${url.substring(0, 50)}`); }
    }

    return {
        label: 'მონაცემთა ინტეგრაცია', passed: issues.length === 0,
        value: issues.length === 0 ? 'წესრიგშია' : `${issues.length} პრობლემა`,
        weight: 10, issues: issues.length > 0 ? issues : undefined
    };
}

// ═══════════════ HELPERS ═══════════════

function loadPages() {
    const pages = {};
    for (const name of SITE_PAGES) {
        try {
            pages[name] = fs.readFileSync(path.join(ROOT, name), 'utf-8');
        } catch {}
    }
    return pages;
}

function extractAllText(response) {
    const parts = [];
    if (response.meta) parts.push(response.meta);
    if (response.summary) parts.push(response.summary);
    if (response.disclaimer) parts.push(response.disclaimer);

    for (const item of response.items || []) {
        if (item.title) parts.push(item.title);
        if (item.body) parts.push(item.body);
        if (item.source) parts.push(item.source);
        if (Array.isArray(item.tags)) parts.push(item.tags.join(' '));
    }
    for (const section of response.sections || []) {
        if (section.title) parts.push(section.title);
        for (const item of section.items || []) {
            if (item.title) parts.push(item.title);
            if (item.body) parts.push(item.body);
        }
    }
    if (response.nextSteps) response.nextSteps.forEach(s => s.text && parts.push(s.text));
    if (response.tips) response.tips.forEach(t => t.text && parts.push(t.text));

    return parts.join(' ');
}

async function callSearchAPI(req, type, data) {
    try {
        const searchHandler = require('./search.js');
        const mockRes = {
            statusCode: null, headers: {}, body: null,
            status(code) { mockRes.statusCode = code; return mockRes; },
            json(d) { mockRes.body = d; return mockRes; },
            end() { return mockRes; },
            setHeader(k, v) { mockRes.headers[k] = v; }
        };
        const mockReq = {
            method: 'POST', body: { type, data },
            headers: { origin: req.headers?.origin || '*', 'x-forwarded-for': '127.0.0.1' },
            socket: { remoteAddress: '127.0.0.1' }
        };
        await searchHandler(mockReq, mockRes);
        if (mockRes.body) { mockRes.body._status = mockRes.statusCode; return mockRes.body; }
    } catch (directErr) {
        console.log('[MedGzuri QA] Direct call failed, trying HTTP:', directErr.message);
    }

    const protocol = req.headers?.['x-forwarded-proto'] || 'https';
    const host = req.headers?.host;
    if (!host) throw new Error('No host header available');

    const url = `${protocol}://${host}/api/search`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, data }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const body = await response.json();
        body._status = response.status;
        return body;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

function calculateTeamScore(checks) {
    let totalWeighted = 0, totalWeight = 0;
    for (const check of Object.values(checks)) {
        const w = check.weight || 10;
        totalWeighted += (check.passed ? 100 : 0) * w;
        totalWeight += w;
    }
    return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;
}

function scoreToGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function buildFullSummary(teamResults, overallScore) {
    const lines = [`საერთო შეფასება: ${scoreToGrade(overallScore)} (${overallScore}/100)`];
    for (const result of Object.values(teamResults)) {
        const icon = result.score >= 75 ? '✅' : result.score >= 50 ? '⚠️' : '❌';
        lines.push(`${icon} ${result.icon} ${result.name}: ${result.grade || scoreToGrade(result.score)} (${result.score}/100)`);
    }
    return lines;
}

function buildFullRecommendations(teamResults) {
    const recs = [];

    for (const result of Object.values(teamResults)) {
        for (const [key, check] of Object.entries(result.checks || {})) {
            if (!check.passed && check.issues) {
                for (const issue of check.issues) {
                    recs.push({ priority: check.weight >= 20 ? 'high' : 'medium', team: result.name, icon: result.icon, text: issue });
                }
            } else if (!check.passed) {
                recs.push({ priority: check.weight >= 20 ? 'high' : 'medium', team: result.name, icon: result.icon, text: `${check.label}: ${check.value}` });
            }
        }
    }

    const seen = new Set();
    return recs.filter(r => { if (seen.has(r.text)) return false; seen.add(r.text); return true; });
}

async function logAudit(report) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/qa_audits`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                score: report.overallScore, grade: report.grade,
                report_json: report, created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('[MedGzuri QA] Audit log failed:', err.message);
    }
}
