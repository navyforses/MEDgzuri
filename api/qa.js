/**
 * MedGzuri QA Audit API
 *
 * Quality control service that audits search pipeline results:
 * 1. Runs test queries against /api/search
 * 2. Validates response structure, Georgian language, medical safety
 * 3. Returns detailed audit report with scores
 *
 * Endpoints:
 *   POST /api/qa { action: "audit" }       — full audit (all 3 search types)
 *   POST /api/qa { action: "audit-single", type: "research", data: {...} } — single query audit
 *   POST /api/qa { action: "health" }      — quick pipeline health check
 */

// ═══════════════ CONFIG ═══════════════
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ═══════════════ TEST CASES ═══════════════
const TEST_CASES = {
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

// Georgian Unicode range: U+10A0–U+10FF (Mkhedruli + Asomtavruli)
const GEORGIAN_REGEX = /[\u10A0-\u10FF]/g;

// Patterns that indicate diagnosis (forbidden in symptoms mode)
const DIAGNOSIS_PATTERNS = [
    /თქვენ გაქვთ/i,
    /თქვენი დიაგნოზი/i,
    /დიაგნოზია/i,
    /you have been diagnosed/i,
    /your diagnosis is/i,
    /you are suffering from/i
];

// ═══════════════ HANDLER ═══════════════
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, type, data } = req.body || {};

    try {
        switch (action) {
            case 'health':
                return res.status(200).json(await runHealthCheck(req));

            case 'audit':
                return res.status(200).json(await runFullAudit(req));

            case 'audit-single':
                if (!type || !data) return res.status(400).json({ error: 'Missing type or data' });
                return res.status(200).json(await auditSingleQuery(req, type, data));

            default:
                return res.status(400).json({ error: 'Invalid action. Use: health, audit, audit-single' });
        }
    } catch (err) {
        console.error('[MedGzuri QA] Error:', err.message);
        return res.status(500).json({ error: 'QA audit failed', details: err.message });
    }
};

// ═══════════════ HEALTH CHECK ═══════════════
async function runHealthCheck(req) {
    const checks = {
        timestamp: new Date().toISOString(),
        api: { status: 'unknown' },
        pipeline: { perplexity: 'unknown', anthropic: 'unknown', n8n: 'unknown' },
        environment: {}
    };

    // Check env vars
    checks.environment = {
        PERPLEXITY_API_KEY: !!process.env.PERPLEXITY_API_KEY,
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        N8N_WEBHOOK_BASE_URL: !!process.env.N8N_WEBHOOK_BASE_URL,
        N8N_WEBHOOK_SECRET: !!process.env.N8N_WEBHOOK_SECRET,
        SUPABASE_URL: !!SUPABASE_URL,
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY
    };

    // Quick API ping
    try {
        const startMs = Date.now();
        const response = await callSearchAPI(req, 'research', TEST_CASES.research.data);
        const elapsed = Date.now() - startMs;

        checks.api = {
            status: response._status === 200 ? 'ok' : 'error',
            responseTimeMs: elapsed,
            statusCode: response._status
        };

        if (response._pipeline) {
            checks.pipeline = {
                perplexity: response._pipeline.perplexity || 'unknown',
                anthropic: response._pipeline.claude || 'unknown',
                n8n: response._pipeline.n8n || 'unknown',
                source: response._pipeline.source || 'unknown'
            };
        }

        checks.isDemo = !!response.isDemo;
    } catch (err) {
        checks.api = { status: 'error', error: err.message };
    }

    checks.overallStatus = checks.api.status === 'ok' ? 'healthy' : 'degraded';
    return checks;
}

// ═══════════════ FULL AUDIT ═══════════════
async function runFullAudit(req) {
    const auditStart = Date.now();
    const results = {};
    let totalScore = 0;
    let totalWeight = 0;

    for (const [type, testCase] of Object.entries(TEST_CASES)) {
        results[type] = await auditSingleQuery(req, type, testCase.data);
        totalScore += results[type].score * results[type].weight;
        totalWeight += results[type].weight;
    }

    const overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

    const report = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - auditStart,
        overallScore,
        grade: scoreToGrade(overallScore),
        results,
        summary: buildSummary(results, overallScore),
        recommendations: buildRecommendations(results)
    };

    // Log audit to Supabase if available
    await logAudit(report);

    return report;
}

// ═══════════════ SINGLE QUERY AUDIT ═══════════════
async function auditSingleQuery(req, type, data) {
    const startMs = Date.now();

    let response;
    try {
        response = await callSearchAPI(req, type, data);
    } catch (err) {
        return {
            type,
            label: TEST_CASES[type]?.label || type,
            score: 0,
            grade: 'F',
            weight: 1,
            responseTimeMs: Date.now() - startMs,
            error: err.message,
            checks: {}
        };
    }

    const elapsed = Date.now() - startMs;
    const checks = {};

    // ── Check 1: HTTP Status ──
    checks.httpStatus = {
        label: 'HTTP სტატუსი',
        passed: response._status === 200,
        value: response._status,
        expected: 200,
        weight: 15
    };

    // ── Check 2: Response Structure ──
    checks.structure = validateStructure(response, type);

    // ── Check 3: Georgian Language Quality ──
    checks.georgianLanguage = validateGeorgian(response);

    // ── Check 4: Medical Safety ──
    checks.medicalSafety = validateMedicalSafety(response, type);

    // ── Check 5: Content Completeness ──
    checks.completeness = validateCompleteness(response, type);

    // ── Check 6: Response Time ──
    checks.responseTime = {
        label: 'პასუხის დრო',
        passed: elapsed < 60000,
        value: `${elapsed}ms`,
        expected: '<60000ms',
        weight: 10,
        details: elapsed < 5000 ? 'შესანიშნავი' : elapsed < 15000 ? 'კარგი' : elapsed < 30000 ? 'ნელი' : 'ძალიან ნელი'
    };

    // ── Check 7: Data Integrity ──
    checks.dataIntegrity = validateDataIntegrity(response);

    // Calculate score
    let totalWeighted = 0;
    let totalWeight = 0;
    for (const check of Object.values(checks)) {
        const w = check.weight || 10;
        totalWeighted += (check.passed ? 100 : 0) * w;
        totalWeight += w;
    }

    const score = totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;

    return {
        type,
        label: TEST_CASES[type]?.label || type,
        score,
        grade: scoreToGrade(score),
        weight: 1,
        responseTimeMs: elapsed,
        isDemo: !!response.isDemo,
        pipeline: response._pipeline || null,
        checks
    };
}

// ═══════════════ VALIDATORS ═══════════════

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

    // sections format (n8n enhanced)
    if (response.sections) {
        const validSections = response.sections.every(s => s.title && (s.items || s.type));
        if (validSections) score++;
        else issues.push('sections ფორმატი არასწორია');
    } else {
        score += 0.5; // items format is acceptable but not ideal
    }

    const passed = score >= 3;

    return {
        label: 'პასუხის სტრუქტურა',
        passed,
        value: `${score}/${maxScore}`,
        weight: 20,
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

    const georgianRatio = Math.round((georgianChars / totalAlpha) * 100);

    // Allow some Latin for medical terms (up to 40%)
    const passed = georgianRatio >= 40;

    return {
        label: 'ქართული ენა',
        passed,
        value: `${georgianRatio}%`,
        expected: '>=40%',
        weight: 20,
        details: georgianRatio >= 70 ? 'შესანიშნავი' : georgianRatio >= 50 ? 'კარგი' : georgianRatio >= 40 ? 'მისაღები' : 'არასაკმარისი',
        issues: !passed ? [`ქართული მხოლოდ ${georgianRatio}%, მინიმუმ 40% საჭიროა`] : undefined
    };
}

function validateMedicalSafety(response, type) {
    const allText = extractAllText(response);
    const issues = [];

    // Check for diagnosis language (especially important in symptoms mode)
    for (const pattern of DIAGNOSIS_PATTERNS) {
        if (pattern.test(allText)) {
            issues.push(`დიაგნოზის ენა აღმოჩენილია: "${allText.match(pattern)?.[0]}"`);
        }
    }

    // Check disclaimer exists
    const hasDisclaimer = !!response.disclaimer || !!response.isDemo;
    if (!hasDisclaimer && type === 'symptoms') {
        issues.push('სიმპტომების ანალიზს დისქლეიმერი აკლია');
    }

    const passed = issues.length === 0;

    return {
        label: 'სამედიცინო უსაფრთხოება',
        passed,
        value: passed ? 'უსაფრთხო' : `${issues.length} პრობლემა`,
        weight: 25,
        issues: issues.length > 0 ? issues : undefined
    };
}

function validateCompleteness(response, type) {
    const items = response.items || (response.sections || []).flatMap(s => s.items || []);
    const issues = [];

    if (items.length === 0) {
        return { label: 'სისრულე', passed: false, value: '0 ელემენტი', weight: 15, issues: ['შედეგები ცარიელია'] };
    }

    let completeItems = 0;
    for (const item of items) {
        let fields = 0;
        if (item.title && item.title.length > 3) fields++;
        if (item.body && item.body.length > 20) fields++;
        if (Array.isArray(item.tags) && item.tags.length > 0) fields++;
        if (item.source || item.url) fields++;

        if (fields >= 2) completeItems++;
    }

    const completenessRatio = Math.round((completeItems / items.length) * 100);
    const passed = completenessRatio >= 50;

    if (completenessRatio < 100) {
        issues.push(`${items.length - completeItems}/${items.length} ელემენტს აკლია ინფორმაცია`);
    }

    // Type-specific checks
    if (type === 'clinics') {
        const hasComparison = !!response.comparison;
        if (!hasComparison && !response.isDemo) {
            issues.push('კლინიკების შედარების ცხრილი აკლია');
        }
    }

    if (type === 'research') {
        const hasUrls = items.some(i => i.url);
        if (!hasUrls && !response.isDemo) {
            issues.push('კვლევების ბმულები აკლია');
        }
    }

    return {
        label: 'სისრულე',
        passed,
        value: `${completeItems}/${items.length} სრული (${completenessRatio}%)`,
        weight: 15,
        issues: issues.length > 0 ? issues : undefined
    };
}

function validateDataIntegrity(response) {
    const issues = [];

    // Check for corrupted/binary text
    const allText = extractAllText(response);
    const binaryPattern = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
    if (binaryPattern.test(allText)) {
        issues.push('ბინარული/კორუფციული სიმბოლოები აღმოჩენილია');
    }

    // Check for broken JSON fragments in text
    if (allText.includes('undefined') || allText.includes('[object Object]')) {
        issues.push('არასწორი მონაცემთა სერიალიზაცია');
    }

    // Check for empty strings where content expected
    const items = response.items || [];
    const emptyTitles = items.filter(i => i.title === '' || i.title === null).length;
    if (emptyTitles > 0) {
        issues.push(`${emptyTitles} ელემენტს ცარიელი სათაური აქვს`);
    }

    // Check URLs are valid format
    const urls = items.filter(i => i.url).map(i => i.url);
    for (const url of urls) {
        try {
            new URL(url);
        } catch {
            issues.push(`არასწორი URL: ${url.substring(0, 50)}`);
        }
    }

    const passed = issues.length === 0;

    return {
        label: 'მონაცემთა ინტეგრაცია',
        passed,
        value: passed ? 'წესრიგშია' : `${issues.length} პრობლემა`,
        weight: 10,
        issues: issues.length > 0 ? issues : undefined
    };
}

// ═══════════════ HELPERS ═══════════════

function extractAllText(response) {
    const parts = [];

    if (response.meta) parts.push(response.meta);
    if (response.summary) parts.push(response.summary);
    if (response.disclaimer) parts.push(response.disclaimer);

    const items = response.items || [];
    for (const item of items) {
        if (item.title) parts.push(item.title);
        if (item.body) parts.push(item.body);
        if (item.source) parts.push(item.source);
        if (Array.isArray(item.tags)) parts.push(item.tags.join(' '));
    }

    const sections = response.sections || [];
    for (const section of sections) {
        if (section.title) parts.push(section.title);
        const sItems = section.items || [];
        for (const item of sItems) {
            if (item.title) parts.push(item.title);
            if (item.body) parts.push(item.body);
        }
    }

    if (response.nextSteps) {
        for (const step of response.nextSteps) {
            if (step.text) parts.push(step.text);
        }
    }

    if (response.tips) {
        for (const tip of response.tips) {
            if (tip.text) parts.push(tip.text);
        }
    }

    return parts.join(' ');
}

async function callSearchAPI(req, type, data) {
    // Try direct handler call first (works in test env and same-process)
    try {
        const searchHandler = require('./search.js');
        const mockRes = {
            statusCode: null,
            headers: {},
            body: null,
            status(code) { mockRes.statusCode = code; return mockRes; },
            json(d) { mockRes.body = d; return mockRes; },
            end() { return mockRes; },
            setHeader(k, v) { mockRes.headers[k] = v; }
        };
        const mockReq = {
            method: 'POST',
            body: { type, data },
            headers: { origin: req.headers?.origin || '*', 'x-forwarded-for': '127.0.0.1' },
            socket: { remoteAddress: '127.0.0.1' }
        };
        await searchHandler(mockReq, mockRes);
        if (mockRes.body) {
            mockRes.body._status = mockRes.statusCode;
            return mockRes.body;
        }
    } catch (directErr) {
        // Fallback to HTTP if direct call fails
        console.log('[MedGzuri QA] Direct call failed, trying HTTP:', directErr.message);
    }

    // HTTP fallback for cross-service calls
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

function scoreToGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function buildSummary(results, overallScore) {
    const lines = [];
    const grade = scoreToGrade(overallScore);

    lines.push(`საერთო შეფასება: ${grade} (${overallScore}/100)`);

    for (const [type, result] of Object.entries(results)) {
        const status = result.score >= 75 ? '✅' : result.score >= 50 ? '⚠️' : '❌';
        lines.push(`${status} ${result.label}: ${result.grade} (${result.score}/100)${result.isDemo ? ' [დემო]' : ''}`);
    }

    return lines;
}

function buildRecommendations(results) {
    const recs = [];

    for (const result of Object.values(results)) {
        if (result.isDemo) {
            recs.push({ priority: 'high', text: 'API გასაღებების კონფიგურაცია (PERPLEXITY_API_KEY, ANTHROPIC_API_KEY)' });
            break;
        }
    }

    for (const result of Object.values(results)) {
        for (const [key, check] of Object.entries(result.checks || {})) {
            if (!check.passed && check.issues) {
                for (const issue of check.issues) {
                    recs.push({ priority: check.weight >= 20 ? 'high' : 'medium', text: `[${result.label}] ${issue}` });
                }
            }
        }
    }

    // Deduplicate
    const seen = new Set();
    return recs.filter(r => {
        if (seen.has(r.text)) return false;
        seen.add(r.text);
        return true;
    });
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
                score: report.overallScore,
                grade: report.grade,
                report_json: report,
                created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('[MedGzuri QA] Audit log failed:', err.message);
    }
}
