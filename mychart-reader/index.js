#!/usr/bin/env node

/**
 * mychart-reader — CLI tool to fetch patient data from BMC MyChart via SMART on FHIR (PKCE)
 *
 * Manual OAuth2 + PKCE implementation (no fhirclient dependency).
 *
 * Flow:
 *   1. Discover auth endpoints from FHIR base URL (.well-known or /metadata)
 *   2. Generate PKCE code_verifier (128 chars) + code_challenge (S256)
 *   3. Open browser to Epic OAuth authorize endpoint
 *   4. Express callback server catches the auth code at /callback
 *   5. Exchange code for access token with PKCE verifier
 *   6. Fetch all FHIR R4 resources for the patient
 *   7. Save JSON files to ./output/ + generate patient-summary.md
 */

const dotenv = require('dotenv');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const fs = require('fs');
const path = require('path');
const express = require('express');

dotenv.config({ path: path.join(__dirname, '.env') });

// ═══════════════ CONFIGURATION ═══════════════

const FHIR_BASE_URLS = [
  process.env.FHIR_BASE_URL,
  'https://fhir.bmc.org/FHIR/api/FHIR/R4',
  'https://mychart.bmc.org/FHIR/api/FHIR/R4',
  'https://mychart.bmc.org/interconnect-prd-fhir/api/FHIR/R4',
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
].filter(Boolean).map((u) => u.replace(/\/+$/, ''));

// Deduplicate while preserving order
const UNIQUE_FHIR_URLS = [...new Set(FHIR_BASE_URLS)];

const CONFIG = {
  clientId: process.env.EPIC_CLIENT_ID || 'eb2d7820-3ffc-48f5-8da4-0461bd04c6b8',
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback',
  port: parseInt(process.env.PORT, 10) || 3000,
  outputDir: path.join(process.cwd(), 'output'),
  scopes: [
    'openid',
    'fhirUser',
    'launch/patient',
    'patient/Patient.read',
    'patient/Observation.read',
    'patient/Condition.read',
    'patient/MedicationRequest.read',
    'patient/DiagnosticReport.read',
    'patient/Encounter.read',
    'patient/AllergyIntolerance.read',
    'patient/Immunization.read',
    'patient/Procedure.read',
    'patient/DocumentReference.read',
  ].join(' '),
};

// ═══════════════ LOGGING ═══════════════

function log(msg) {
  console.log(`[mychart-reader] ${msg}`);
}

function logHttp(method, url, status) {
  const statusText = status >= 200 && status < 300 ? `\x1b[32m${status}\x1b[0m` : `\x1b[31m${status}\x1b[0m`;
  console.log(`  ${method} ${url} → ${statusText}`);
}

// ═══════════════ PKCE UTILITIES ═══════════════

function generateCodeVerifier() {
  // 128 characters from unreserved URL-safe characters
  const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.randomBytes(128);
  let verifier = '';
  for (let i = 0; i < 128; i++) {
    verifier += unreserved[bytes[i] % unreserved.length];
  }
  return verifier;
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ═══════════════ SMART ENDPOINT DISCOVERY ═══════════════

async function discoverEndpoints(fhirBaseUrl) {
  // Try .well-known/smart-configuration first
  const smartConfigUrl = `${fhirBaseUrl}/.well-known/smart-configuration`;
  try {
    log(`Trying ${smartConfigUrl}`);
    const resp = await fetch(smartConfigUrl, { signal: AbortSignal.timeout(10000) });
    logHttp('GET', smartConfigUrl, resp.status);
    if (resp.ok) {
      const config = await resp.json();
      if (config.authorization_endpoint && config.token_endpoint) {
        log('Discovered endpoints via .well-known/smart-configuration');
        return {
          authorizationEndpoint: config.authorization_endpoint,
          tokenEndpoint: config.token_endpoint,
        };
      }
    }
  } catch (err) {
    log(`  .well-known failed: ${err.message}`);
  }

  // Fallback: FHIR /metadata (CapabilityStatement)
  const metadataUrl = `${fhirBaseUrl}/metadata`;
  try {
    log(`Trying ${metadataUrl}`);
    const resp = await fetch(metadataUrl, {
      headers: { Accept: 'application/fhir+json' },
      signal: AbortSignal.timeout(10000),
    });
    logHttp('GET', metadataUrl, resp.status);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const metadata = await resp.json();
    const security = metadata.rest?.[0]?.security;
    const oauthExt = security?.extension?.find(
      (e) => e.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
    );

    if (!oauthExt) {
      throw new Error('No OAuth extension in CapabilityStatement');
    }

    const authEndpoint = oauthExt.extension?.find((e) => e.url === 'authorize')?.valueUri;
    const tokenEndpoint = oauthExt.extension?.find((e) => e.url === 'token')?.valueUri;

    if (!authEndpoint || !tokenEndpoint) {
      throw new Error('Missing authorize/token URIs in metadata');
    }

    log('Discovered endpoints via /metadata CapabilityStatement');
    return { authorizationEndpoint: authEndpoint, tokenEndpoint: tokenEndpoint };
  } catch (err) {
    log(`  /metadata failed: ${err.message}`);
    throw new Error(`Could not discover SMART endpoints from ${fhirBaseUrl}`);
  }
}

async function discoverWithFallback() {
  for (const baseUrl of UNIQUE_FHIR_URLS) {
    log(`\nTrying FHIR base URL: ${baseUrl}`);
    try {
      const endpoints = await discoverEndpoints(baseUrl);
      return { fhirBaseUrl: baseUrl, ...endpoints };
    } catch (err) {
      log(`  Failed: ${err.message}`);
    }
  }
  throw new Error(
    'Could not discover SMART endpoints from any configured FHIR base URL.\n' +
    'Tried: ' + UNIQUE_FHIR_URLS.join(', ')
  );
}

// ═══════════════ OAUTH TOKEN EXCHANGE ═══════════════

async function exchangeCodeForToken(tokenEndpoint, code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CONFIG.redirectUri,
    client_id: CONFIG.clientId,
    code_verifier: codeVerifier,
  });

  log(`Exchanging auth code at ${tokenEndpoint}`);
  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  logHttp('POST', tokenEndpoint, resp.status);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${errText}`);
  }

  const tokenData = await resp.json();
  log(`Token response keys: ${Object.keys(tokenData).join(', ')}`);
  return tokenData;
}

// ═══════════════ FHIR RESOURCE FETCHING ═══════════════

async function fhirGet(url, accessToken) {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });
  logHttp('GET', url, resp.status);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    log(`  Response body: ${errText.slice(0, 200)}`);
    return null;
  }
  return resp.json();
}

async function fetchResource(fhirBaseUrl, resourceType, accessToken, patientId, params = {}) {
  if (resourceType === 'Patient') {
    const url = `${fhirBaseUrl}/Patient/${patientId}`;
    return fhirGet(url, accessToken);
  }

  const url = new URL(`${fhirBaseUrl}/${resourceType}`);
  url.searchParams.set('patient', patientId);
  url.searchParams.set('_count', '200');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fhirGet(url.toString(), accessToken);
}

const RESOURCE_CONFIGS = [
  { type: 'Patient', filename: 'patient.json' },
  { type: 'Condition', filename: 'conditions.json' },
  { type: 'Observation', filename: 'observations.json', params: { category: 'laboratory', _count: '500' } },
  { type: 'MedicationRequest', filename: 'medication-requests.json' },
  { type: 'DiagnosticReport', filename: 'diagnostic-reports.json' },
  { type: 'Encounter', filename: 'encounters.json', params: { date: `ge${twelveMonthsAgo()}` } },
  { type: 'AllergyIntolerance', filename: 'allergy-intolerances.json' },
  { type: 'Immunization', filename: 'immunizations.json' },
  { type: 'Procedure', filename: 'procedures.json' },
  { type: 'DocumentReference', filename: 'document-references.json' },
];

function twelveMonthsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0];
}

async function fetchAllResources(fhirBaseUrl, accessToken, patientId) {
  log(`\nFetching FHIR R4 resources for patient: ${patientId}\n`);

  const results = {};

  for (const rc of RESOURCE_CONFIGS) {
    process.stdout.write(`  ${rc.type}... `);
    try {
      const data = await fetchResource(fhirBaseUrl, rc.type, accessToken, patientId, rc.params || {});
      if (data) {
        results[rc.type] = data;
        const count = rc.type === 'Patient' ? 1 : (data.total ?? data.entry?.length ?? 0);
        console.log(`${count} record(s)`);
      } else {
        results[rc.type] = null;
        console.log('(empty or denied)');
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results[rc.type] = null;
    }
  }

  return results;
}

// ═══════════════ FILE OUTPUT ═══════════════

function saveJsonFiles(outputDir, results) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const rc of RESOURCE_CONFIGS) {
    const data = results[rc.type];
    if (data) {
      const filePath = path.join(outputDir, rc.filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      log(`Saved ${rc.filename}`);
    }
  }
}

// ═══════════════ MARKDOWN SUMMARY ═══════════════

function entries(bundle) {
  if (!bundle || !bundle.entry) return [];
  return bundle.entry.map((e) => e.resource).filter(Boolean);
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function escMd(str) {
  if (!str) return '';
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function isAbnormal(obs) {
  // Check interpretation coding
  const interp = obs.interpretation?.[0]?.coding?.[0]?.code;
  if (interp && !['N', 'normal'].includes(interp.toLowerCase())) return true;

  // Check if value is outside reference range
  if (obs.valueQuantity?.value != null && obs.referenceRange?.[0]) {
    const val = obs.valueQuantity.value;
    const low = obs.referenceRange[0].low?.value;
    const high = obs.referenceRange[0].high?.value;
    if (low != null && val < low) return true;
    if (high != null && val > high) return true;
  }

  return false;
}

function generateMarkdownSummary(results) {
  const lines = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push('# Patient Summary');
  lines.push(`\n_Generated on ${now} by mychart-reader (SMART on FHIR)_\n`);

  // ═══════════════ Demographics ═══════════════
  lines.push('## Demographics\n');
  const pt = results.Patient;
  if (pt) {
    const name = pt.name?.[0];
    const fullName = name
      ? [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ')
      : 'Unknown';
    const mrn = pt.identifier?.find((i) =>
      i.type?.coding?.some((c) => c.code === 'MR' || c.code === 'MRN')
    )?.value || pt.identifier?.[0]?.value || 'N/A';

    lines.push(`- **Name:** ${fullName}`);
    lines.push(`- **Date of Birth:** ${fmtDate(pt.birthDate)}`);
    lines.push(`- **MRN:** ${mrn}`);
    lines.push(`- **Gender:** ${pt.gender || 'N/A'}`);

    const addr = pt.address?.[0];
    if (addr) {
      const addrStr = [addr.line?.join(', '), addr.city, addr.state, addr.postalCode]
        .filter(Boolean).join(', ');
      lines.push(`- **Address:** ${addrStr}`);
    }
    const phone = pt.telecom?.find((t) => t.system === 'phone');
    if (phone) lines.push(`- **Phone:** ${phone.value}`);
    const email = pt.telecom?.find((t) => t.system === 'email');
    if (email) lines.push(`- **Email:** ${email.value}`);
  } else {
    lines.push('_Patient demographics not available._');
  }

  // ═══════════════ Active Diagnoses ═══════════════
  lines.push('\n## Active Diagnoses\n');
  const conditions = entries(results.Condition);
  if (conditions.length > 0) {
    lines.push('| Code | Description | Onset Date |');
    lines.push('|------|-------------|------------|');
    for (const c of conditions) {
      const code = c.code?.coding?.[0]?.code || '';
      const display = escMd(c.code?.coding?.[0]?.display || c.code?.text || 'Unknown');
      const onset = fmtDate(c.onsetDateTime || c.onsetPeriod?.start || c.recordedDate);
      lines.push(`| ${code} | ${display} | ${onset} |`);
    }
  } else {
    lines.push('_No diagnoses on file._');
  }

  // ═══════════════ Allergies ═══════════════
  lines.push('\n## Allergies\n');
  const allergies = entries(results.AllergyIntolerance);
  if (allergies.length > 0) {
    lines.push('| Allergen | Reaction | Severity | Status |');
    lines.push('|----------|----------|----------|--------|');
    for (const a of allergies) {
      const allergen = escMd(a.code?.coding?.[0]?.display || a.code?.text || 'Unknown');
      const reaction = escMd(a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display || 'N/A');
      const severity = a.reaction?.[0]?.severity || 'N/A';
      const status = a.clinicalStatus?.coding?.[0]?.code || 'N/A';
      lines.push(`| ${allergen} | ${reaction} | ${severity} | ${status} |`);
    }
  } else {
    lines.push('_No allergies on file._');
  }

  // ═══════════════ Current Medications ═══════════════
  lines.push('\n## Current Medications\n');
  const meds = entries(results.MedicationRequest);
  if (meds.length > 0) {
    lines.push('| Drug | Dose | Frequency | Status |');
    lines.push('|------|------|-----------|--------|');
    for (const m of meds) {
      const drug = escMd(
        m.medicationCodeableConcept?.coding?.[0]?.display
        || m.medicationCodeableConcept?.text
        || m.medicationReference?.display
        || 'Unknown'
      );
      const dosageInst = m.dosageInstruction?.[0];
      const dose = escMd(dosageInst?.doseAndRate?.[0]?.doseQuantity
        ? `${dosageInst.doseAndRate[0].doseQuantity.value} ${dosageInst.doseAndRate[0].doseQuantity.unit || ''}`
        : dosageInst?.text || 'N/A');
      const frequency = escMd(dosageInst?.timing?.code?.text
        || dosageInst?.timing?.repeat?.frequency
          ? `${dosageInst?.timing?.repeat?.frequency || ''}x/${dosageInst?.timing?.repeat?.period || ''} ${dosageInst?.timing?.repeat?.periodUnit || ''}`
          : 'N/A');
      const status = m.status || 'N/A';
      lines.push(`| ${drug} | ${dose} | ${frequency} | ${status} |`);
    }
  } else {
    lines.push('_No medications on file._');
  }

  // ═══════════════ Lab Results ═══════════════
  lines.push('\n## Lab Results (most recent first)\n');
  const observations = entries(results.Observation);
  const labs = observations.filter((o) =>
    o.category?.some((c) => c.coding?.some((cd) => cd.code === 'laboratory'))
  );

  if (labs.length > 0) {
    // Sort by date descending
    labs.sort((a, b) => {
      const aDate = a.effectiveDateTime || a.issued || '';
      const bDate = b.effectiveDateTime || b.issued || '';
      return bDate.localeCompare(aDate);
    });

    lines.push('| Test | Value | Units | Range | Date | Flag |');
    lines.push('|------|-------|-------|-------|------|------|');

    for (const lab of labs) {
      const testName = escMd(lab.code?.coding?.[0]?.display || lab.code?.text || 'Unknown');

      let value = '';
      if (lab.valueQuantity) {
        value = `${lab.valueQuantity.value}`;
      } else if (lab.valueString) {
        value = escMd(lab.valueString);
      } else if (lab.valueCodeableConcept) {
        value = escMd(lab.valueCodeableConcept.text || lab.valueCodeableConcept.coding?.[0]?.display || '');
      }

      const units = lab.valueQuantity?.unit || lab.valueQuantity?.code || '';

      let range = '';
      if (lab.referenceRange?.[0]) {
        const rr = lab.referenceRange[0];
        if (rr.text) {
          range = escMd(rr.text);
        } else if (rr.low?.value != null && rr.high?.value != null) {
          range = `${rr.low.value}-${rr.high.value}`;
        } else if (rr.low?.value != null) {
          range = `>=${rr.low.value}`;
        } else if (rr.high?.value != null) {
          range = `<=${rr.high.value}`;
        }
      }

      const date = fmtDate(lab.effectiveDateTime || lab.issued);
      const abnormal = isAbnormal(lab);
      const flag = abnormal ? '\u26a0\ufe0f' : '';

      lines.push(`| ${testName} | ${value} | ${units} | ${range} | ${date} | ${flag} |`);
    }
  } else {
    lines.push('_No lab results on file._');
  }

  // ═══════════════ Diagnostic Reports ═══════════════
  lines.push('\n## Diagnostic Reports\n');
  const reports = entries(results.DiagnosticReport);
  if (reports.length > 0) {
    for (const r of reports) {
      const title = escMd(r.code?.coding?.[0]?.display || r.code?.text || 'Report');
      const date = fmtDate(r.effectiveDateTime || r.effectivePeriod?.start || r.issued);
      const status = r.status || 'N/A';
      const category = r.category?.[0]?.coding?.[0]?.display || '';
      lines.push(`### ${title}`);
      lines.push(`- **Date:** ${date}`);
      lines.push(`- **Status:** ${status}`);
      if (category) lines.push(`- **Category:** ${category}`);
      if (r.conclusion) lines.push(`- **Conclusion:** ${escMd(r.conclusion)}`);
      if (r.presentedForm?.length) {
        lines.push(`- _${r.presentedForm.length} attached document(s) (see JSON)_`);
      }
      lines.push('');
    }
  } else {
    lines.push('_No diagnostic reports on file._');
  }

  // ═══════════════ Recent Encounters ═══════════════
  lines.push('\n## Recent Encounters\n');
  const encounters = entries(results.Encounter);
  if (encounters.length > 0) {
    lines.push('| Date | Type | Provider | Department |');
    lines.push('|------|------|----------|------------|');
    for (const enc of encounters) {
      const date = fmtDate(enc.period?.start);
      const type = escMd(enc.type?.[0]?.coding?.[0]?.display || enc.type?.[0]?.text || enc.class?.display || 'N/A');
      const provider = escMd(
        enc.participant?.[0]?.individual?.display || ''
      );
      const dept = escMd(
        enc.location?.[0]?.location?.display
        || enc.serviceProvider?.display
        || ''
      );
      lines.push(`| ${date} | ${type} | ${provider} | ${dept} |`);
    }
  } else {
    lines.push('_No recent encounters on file._');
  }

  // ═══════════════ Immunizations ═══════════════
  lines.push('\n## Immunizations\n');
  const immunizations = entries(results.Immunization);
  if (immunizations.length > 0) {
    lines.push('| Vaccine | Date | Status |');
    lines.push('|---------|------|--------|');
    for (const imm of immunizations) {
      const vaccine = escMd(imm.vaccineCode?.coding?.[0]?.display || imm.vaccineCode?.text || 'Unknown');
      const date = fmtDate(imm.occurrenceDateTime || imm.occurrenceString);
      const status = imm.status || 'N/A';
      lines.push(`| ${vaccine} | ${date} | ${status} |`);
    }
  } else {
    lines.push('_No immunization records on file._');
  }

  // ═══════════════ Procedures ═══════════════
  lines.push('\n## Procedures\n');
  const procedures = entries(results.Procedure);
  if (procedures.length > 0) {
    lines.push('| Procedure | Date | Status |');
    lines.push('|-----------|------|--------|');
    for (const p of procedures) {
      const name = escMd(p.code?.coding?.[0]?.display || p.code?.text || 'Unknown');
      const date = fmtDate(p.performedDateTime || p.performedPeriod?.start);
      const status = p.status || 'N/A';
      lines.push(`| ${name} | ${date} | ${status} |`);
    }
  } else {
    lines.push('_No procedures on file._');
  }

  // ═══════════════ Documents Available ═══════════════
  lines.push('\n## Documents Available\n');
  const docs = entries(results.DocumentReference);
  if (docs.length > 0) {
    lines.push('| Document | Category | Date | Format | Status |');
    lines.push('|----------|----------|------|--------|--------|');
    for (const doc of docs) {
      const desc = escMd(doc.description || doc.type?.coding?.[0]?.display || doc.type?.text || 'Document');
      const category = escMd(doc.category?.[0]?.coding?.[0]?.display || '');
      const date = fmtDate(doc.date || doc.context?.period?.start);
      const format = doc.content?.[0]?.attachment?.contentType || '';
      const status = doc.status || 'N/A';
      lines.push(`| ${desc} | ${category} | ${date} | ${format} | ${status} |`);
    }
  } else {
    lines.push('_No clinical documents on file._');
  }

  lines.push('\n---');
  lines.push('_This summary was auto-generated from FHIR R4 resources. Consult your healthcare provider for medical advice._\n');

  return lines.join('\n');
}

// ═══════════════ CONSOLE SUMMARY ═══════════════

function printConsoleSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('  PATIENT DATA SUMMARY');
  console.log('='.repeat(60));

  const pt = results.Patient;
  if (pt) {
    const name = pt.name?.[0];
    const fullName = name
      ? [name.given?.join(' '), name.family].filter(Boolean).join(' ')
      : 'Unknown';
    console.log(`\n  Patient: ${fullName}`);
    console.log(`  DOB:     ${fmtDate(pt.birthDate)}`);
    console.log(`  Gender:  ${pt.gender || 'N/A'}`);
  }

  const counts = {
    Conditions: entries(results.Condition).length,
    Allergies: entries(results.AllergyIntolerance).length,
    Medications: entries(results.MedicationRequest).length,
    'Lab Results': entries(results.Observation).length,
    'Diagnostic Reports': entries(results.DiagnosticReport).length,
    Encounters: entries(results.Encounter).length,
    Immunizations: entries(results.Immunization).length,
    Procedures: entries(results.Procedure).length,
    Documents: entries(results.DocumentReference).length,
  };

  console.log('\n  Records retrieved:');
  for (const [label, count] of Object.entries(counts)) {
    const bar = '\u2588'.repeat(Math.min(count, 30));
    console.log(`    ${label.padEnd(20)} ${String(count).padStart(4)}  ${bar}`);
  }

  // Highlight abnormal labs
  const labs = entries(results.Observation);
  const abnormalLabs = labs.filter(isAbnormal);
  if (abnormalLabs.length > 0) {
    console.log(`\n  \u26a0\ufe0f  ${abnormalLabs.length} abnormal lab result(s) found:`);
    for (const lab of abnormalLabs.slice(0, 10)) {
      const name = lab.code?.coding?.[0]?.display || lab.code?.text || 'Unknown';
      const val = lab.valueQuantity ? `${lab.valueQuantity.value} ${lab.valueQuantity.unit || ''}` : '';
      console.log(`     - ${name}: ${val}`);
    }
    if (abnormalLabs.length > 10) {
      console.log(`     ... and ${abnormalLabs.length - 10} more`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// ═══════════════ CALLBACK SERVER ═══════════════

function startCallbackServerAndAuth(authUrl) {
  return new Promise((resolve, reject) => {
    const app = express();
    let server;

    app.get('/callback', (req, res) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        res.send(`
          <html><body style="font-family:system-ui;text-align:center;padding:50px">
            <h1 style="color:#e74c3c">Authorization Failed</h1>
            <p><strong>${escHtml(error)}</strong>: ${escHtml(error_description || 'Unknown error')}</p>
            <p>You can close this window.</p>
          </body></html>
        `);
        server.close();
        reject(new Error(`OAuth error: ${error} — ${error_description}`));
        return;
      }

      if (!code) {
        res.send(`
          <html><body style="font-family:system-ui;text-align:center;padding:50px">
            <h1 style="color:#e74c3c">Missing Authorization Code</h1>
            <p>No authorization code was received in the callback.</p>
          </body></html>
        `);
        server.close();
        reject(new Error('No authorization code in callback'));
        return;
      }

      res.send(`
        <html><body style="font-family:system-ui;text-align:center;padding:50px">
          <h1 style="color:#27ae60">Authorization Successful</h1>
          <p>Your medical records are being downloaded.</p>
          <p>You can close this window and return to the terminal.</p>
        </body></html>
      `);

      server.close();
      resolve({ code, receivedState: state });
    });

    server = app.listen(CONFIG.port, async () => {
      log(`Callback server listening on http://localhost:${CONFIG.port}/callback`);
      log('Opening browser for MyChart login...\n');

      try {
        const open = (await import('open')).default;
        await open(authUrl);
      } catch {
        console.log('\nCould not open browser automatically.');
        console.log('Please open this URL manually:\n');
        console.log(`  ${authUrl}\n`);
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CONFIG.port} is already in use. Set a different PORT in .env`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 5 minutes. Please try again.'));
    }, 5 * 60 * 1000);

    // Clean up timeout if resolved
    const origResolve = resolve;
    const origReject = reject;
    resolve = (val) => { clearTimeout(timeout); origResolve(val); };
    reject = (err) => { clearTimeout(timeout); origReject(err); };
  });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════ MAIN ═══════════════

async function main() {
  console.log('');
  console.log('\x1b[1m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║        mychart-reader v1.0.0              ║\x1b[0m');
  console.log('\x1b[1m║   BMC MyChart — SMART on FHIR + PKCE     ║\x1b[0m');
  console.log('\x1b[1m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');

  log(`Client ID: ${CONFIG.clientId}`);
  log(`Redirect:  ${CONFIG.redirectUri}`);

  // Step 1: Discover SMART endpoints (with URL fallback)
  const { fhirBaseUrl, authorizationEndpoint, tokenEndpoint } = await discoverWithFallback();
  log(`\nUsing FHIR base: ${fhirBaseUrl}`);
  log(`Authorization:   ${authorizationEndpoint}`);
  log(`Token:           ${tokenEndpoint}`);

  // Step 2: Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  log(`\nPKCE code_verifier length: ${codeVerifier.length}`);
  log(`PKCE code_challenge: ${codeChallenge}`);

  // Step 3: Build authorization URL
  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CONFIG.clientId);
  authUrl.searchParams.set('redirect_uri', CONFIG.redirectUri);
  authUrl.searchParams.set('scope', CONFIG.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('aud', fhirBaseUrl);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Step 4: Start callback server + open browser
  const { code, receivedState } = await startCallbackServerAndAuth(authUrl.toString());

  // Verify state parameter
  if (receivedState !== state) {
    console.error('\nERROR: OAuth state mismatch — possible CSRF attack. Aborting.');
    process.exit(1);
  }

  log('Authorization code received.');

  // Step 5: Exchange code for access token
  const tokenResponse = await exchangeCodeForToken(tokenEndpoint, code, codeVerifier);
  const accessToken = tokenResponse.access_token;
  const patientId = tokenResponse.patient;

  if (!accessToken) {
    console.error('ERROR: No access_token in token response.');
    process.exit(1);
  }
  if (!patientId) {
    console.error('ERROR: No patient ID in token response. Server may not support standalone patient launch.');
    process.exit(1);
  }

  log(`Access token obtained (expires_in: ${tokenResponse.expires_in || 'N/A'}s)`);
  log(`Patient ID: ${patientId}`);

  // Step 6: Fetch all FHIR resources
  const results = await fetchAllResources(fhirBaseUrl, accessToken, patientId);

  // Step 7: Save JSON files
  log(`\nSaving to ${CONFIG.outputDir}/`);
  saveJsonFiles(CONFIG.outputDir, results);

  // Step 8: Generate Markdown summary
  const markdown = generateMarkdownSummary(results);
  const mdPath = path.join(CONFIG.outputDir, 'patient-summary.md');
  fs.writeFileSync(mdPath, markdown);
  log('Saved patient-summary.md');

  // Step 9: Print console summary
  printConsoleSummary(results);

  log('Done! Open output/patient-summary.md for the full summary.\n');
}

main().catch((err) => {
  console.error(`\n\x1b[31mFatal error: ${err.message}\x1b[0m`);
  process.exit(1);
});
