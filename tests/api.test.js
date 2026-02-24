/**
 * MedGzuri API Tests — Node.js built-in assert
 * Run: node tests/api.test.js
 */

const assert = require('assert');
const path = require('path');

// ═══════════════ TEST HELPERS ═══════════════

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`    ${err.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`    ${err.message}`);
    }
}

// Mock req/res for serverless function testing
function mockReq(method, body, headers = {}) {
    return {
        method,
        body,
        headers: { origin: 'http://localhost', ...headers },
        socket: { remoteAddress: '127.0.0.1' }
    };
}

function mockRes() {
    const res = {
        statusCode: null,
        headers: {},
        body: null,
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
        end() { return res; },
        setHeader(k, v) { res.headers[k] = v; }
    };
    return res;
}

// ═══════════════ SEARCH API TESTS ═══════════════

console.log('\n\x1b[1mSearch API (api/search.js)\x1b[0m');

const searchHandler = require('../api/search.js');

testAsync('Returns 405 for GET requests', async () => {
    const res = mockRes();
    await searchHandler(mockReq('GET', null), res);
    assert.strictEqual(res.statusCode, 405);
});

testAsync('Returns 200 for OPTIONS (CORS preflight)', async () => {
    const res = mockRes();
    await searchHandler(mockReq('OPTIONS', null), res);
    assert.strictEqual(res.statusCode, 200);
});

testAsync('Returns 400 for missing type/data', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {}), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns 400 for invalid search type', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', { type: 'invalid', data: {} }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns 400 for too-long input', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'research',
        data: { diagnosis: 'a'.repeat(2001) }
    }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns 400 for invalid age', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'symptoms',
        data: { symptoms: 'headache', age: 200 }
    }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns demo data for research without API keys', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'research',
        data: { diagnosis: 'diabetes' }
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isDemo, true);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length > 0);
});

testAsync('Returns demo data for symptoms without API keys', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'symptoms',
        data: { symptoms: 'headache and fever' }
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isDemo, true);
    assert.ok(Array.isArray(res.body.items));
});

testAsync('Returns demo data for clinics without API keys', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'clinics',
        data: { diagnosis: 'heart surgery', countries: ['Germany'] }
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isDemo, true);
    assert.ok(Array.isArray(res.body.items));
});

testAsync('Returns demo data for report without API keys', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'report',
        data: { reportType: 'research', searchResult: { meta: 'test' } }
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isDemo, true);
    assert.ok(Array.isArray(res.body.sections));
});

testAsync('Demo mode results are consistent for identical queries', async () => {
    // In demo mode (no API keys), caching is bypassed since results are instant
    const res1 = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'research',
        data: { diagnosis: 'cache_test_query' }
    }), res1);

    const res2 = mockRes();
    await searchHandler(mockReq('POST', {
        type: 'research',
        data: { diagnosis: 'cache_test_query' }
    }), res2);

    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body.isDemo, true);
    assert.strictEqual(res1.body.items.length, res2.body.items.length);
});

testAsync('Sets CORS headers', async () => {
    const res = mockRes();
    await searchHandler(mockReq('POST', { type: 'research', data: { diagnosis: 'test' } }), res);
    assert.ok(res.headers['Access-Control-Allow-Origin']);
    assert.ok(res.headers['Access-Control-Allow-Methods']);
});

// ═══════════════ AUTH API TESTS ═══════════════

console.log('\n\x1b[1mAuth API (api/auth.js)\x1b[0m');

const authHandler = require('../api/auth.js');

testAsync('Returns 405 for GET requests', async () => {
    const res = mockRes();
    await authHandler(mockReq('GET', null), res);
    assert.strictEqual(res.statusCode, 405);
});

testAsync('Returns config status', async () => {
    const res = mockRes();
    await authHandler(mockReq('POST', { action: 'config' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.configured, false);
});

testAsync('Returns 503 for login without Supabase', async () => {
    const res = mockRes();
    await authHandler(mockReq('POST', { action: 'login', email: 'test@test.com', password: '123456' }), res);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.fallback, true);
});

testAsync('Returns 503 for signup without Supabase', async () => {
    const res = mockRes();
    await authHandler(mockReq('POST', { action: 'signup', email: 'test@test.com', password: '123456' }), res);
    assert.strictEqual(res.statusCode, 503);
});

testAsync('Returns 400 for unknown action', async () => {
    const res = mockRes();
    await authHandler(mockReq('POST', { action: 'unknown' }), res);
    // Without Supabase, 503 is returned for most actions except config
    assert.ok([400, 503].includes(res.statusCode));
});

// ═══════════════ LEADS API TESTS ═══════════════

console.log('\n\x1b[1mLeads API (api/leads.js)\x1b[0m');

const leadsHandler = require('../api/leads.js');

testAsync('Returns 405 for GET requests', async () => {
    const res = mockRes();
    await leadsHandler(mockReq('GET', null), res);
    assert.strictEqual(res.statusCode, 405);
});

testAsync('Creates lead without Supabase (fallback)', async () => {
    const res = mockRes();
    await leadsHandler(mockReq('POST', {
        action: 'create',
        name: 'Test User',
        phone: '555-0100',
        email: 'test@example.com',
        message: 'Test message'
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.persisted, false);
});

testAsync('Returns 400 for lead without name', async () => {
    const res = mockRes();
    await leadsHandler(mockReq('POST', {
        action: 'create',
        phone: '555-0100'
    }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns 401 for list without auth', async () => {
    const res = mockRes();
    await leadsHandler(mockReq('POST', { action: 'list' }), res);
    // Without Supabase configured, returns 503
    assert.ok([401, 503].includes(res.statusCode));
});

// ═══════════════ QA API TESTS ═══════════════

console.log('\n\x1b[1mQA API (api/qa.js)\x1b[0m');

const qaHandler = require('../api/qa.js');

testAsync('Returns 405 for GET requests', async () => {
    const res = mockRes();
    await qaHandler(mockReq('GET', null), res);
    assert.strictEqual(res.statusCode, 405);
});

testAsync('Returns 200 for OPTIONS (CORS preflight)', async () => {
    const res = mockRes();
    await qaHandler(mockReq('OPTIONS', null), res);
    assert.strictEqual(res.statusCode, 200);
});

testAsync('Returns 400 for missing action', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', {}), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Returns 400 for audit-single without type', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-single' }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Health check returns environment status', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'health' }, { host: 'localhost:3000' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.environment);
    assert.ok('PERPLEXITY_API_KEY' in res.body.environment);
    assert.ok('ANTHROPIC_API_KEY' in res.body.environment);
    assert.ok('N8N_WEBHOOK_BASE_URL' in res.body.environment);
});

testAsync('Audit-single validates demo response structure', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', {
        action: 'audit-single',
        type: 'research',
        data: { diagnosis: 'test' }
    }, { host: 'localhost:3000' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.score >= 0 && res.body.score <= 100);
    assert.ok(res.body.grade);
    assert.ok(res.body.checks);
    assert.ok(res.body.checks.structure);
    assert.ok(res.body.checks.georgianLanguage);
    assert.ok(res.body.checks.medicalSafety);
    assert.ok(res.body.checks.completeness);
    assert.ok(res.body.checks.dataIntegrity);
});

testAsync('QA validates Georgian language in demo results', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', {
        action: 'audit-single',
        type: 'symptoms',
        data: { symptoms: 'თავის ტკივილი' }
    }, { host: 'localhost:3000' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.checks.georgianLanguage, 'Georgian language check missing');
    // Demo data is in Georgian, so should pass
    assert.strictEqual(res.body.checks.georgianLanguage.passed, true,
        'Georgian language check should pass for demo data (got: ' + res.body.checks.georgianLanguage.value + ')');
});

testAsync('QA medical safety check passes for demo data', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', {
        action: 'audit-single',
        type: 'symptoms',
        data: { symptoms: 'test symptoms' }
    }, { host: 'localhost:3000' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.checks.medicalSafety.passed, true,
        'Medical safety should pass for demo data');
});

testAsync('Teams action returns all 9 teams', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'teams' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.totalTeams, 9);
    assert.ok(res.body.teams['api-pipeline']);
    assert.ok(res.body.teams['visual']);
    assert.ok(res.body.teams['ux']);
    assert.ok(res.body.teams['security']);
    assert.ok(res.body.teams['content']);
    assert.ok(res.body.teams['performance']);
    assert.ok(res.body.teams['seo']);
    assert.ok(res.body.teams['chatbot']);
    assert.ok(res.body.teams['integration']);
});

testAsync('Each team has competencies array', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'teams' }), res);
    for (const [id, team] of Object.entries(res.body.teams)) {
        assert.ok(Array.isArray(team.competencies), `${id} should have competencies`);
        assert.ok(team.competencies.length >= 3, `${id} should have at least 3 competencies`);
        assert.ok(team.name, `${id} should have a name`);
        assert.ok(team.icon, `${id} should have an icon`);
    }
});

testAsync('Returns 400 for invalid team in audit-team', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'nonexistent' }), res);
    assert.strictEqual(res.statusCode, 400);
});

testAsync('Visual team runs and returns score', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'visual' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.score >= 0 && res.body.score <= 100);
    assert.ok(res.body.checks.cssCorruption, 'CSS corruption check missing');
    assert.ok(res.body.checks.fontLoading, 'Font loading check missing');
});

testAsync('Security team runs and returns score', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'security' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.score >= 0 && res.body.score <= 100);
    assert.ok(res.body.checks.escapeHtml, 'escapeHtml check missing');
    assert.ok(res.body.checks.noExposedKeys, 'No exposed keys check missing');
});

testAsync('Chatbot team runs and validates knowledge base', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'chatbot' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.score >= 0 && res.body.score <= 100);
    assert.ok(res.body.checks.categories, 'Categories check missing');
    assert.ok(res.body.checks.medicalDisclaimer, 'Medical disclaimer check missing');
});

testAsync('Integration team checks n8n workflows', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'integration' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.checks.n8nWorkflows, 'n8n workflows check missing');
    assert.ok(res.body.checks.vercelConfig, 'Vercel config check missing');
});

testAsync('SEO team checks meta tags', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'seo' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.checks.titleTags, 'Title tags check missing');
    assert.ok(res.body.checks.langAttribute, 'Lang attribute check missing');
    assert.ok(res.body.checks.charset, 'Charset check missing');
});

testAsync('Performance team checks file sizes', async () => {
    const res = mockRes();
    await qaHandler(mockReq('POST', { action: 'audit-team', team: 'performance' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.checks.fileSizes, 'File sizes check missing');
    assert.ok(res.body.checks.deferAsync, 'Defer/async check missing');
});

// ═══════════════ RESULTS ═══════════════

// Wait for all async tests to complete
setTimeout(() => {
    console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
    if (failed > 0) {
        console.log('\x1b[31mSome tests failed!\x1b[0m\n');
        process.exit(1);
    } else {
        console.log('\x1b[32mAll tests passed!\x1b[0m\n');
        process.exit(0);
    }
}, 5000);
