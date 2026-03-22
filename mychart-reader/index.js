#!/usr/bin/env node

/**
 * mychart-reader — CLI tool to fetch patient data from MyChart via SMART on FHIR (PKCE)
 *
 * Flow:
 *   1. Discover FHIR server endpoints via .well-known/smart-configuration
 *   2. Generate PKCE code_verifier + code_challenge
 *   3. Open browser for OAuth authorization
 *   4. Local Express server catches the callback with auth code
 *   5. Exchange code for access token (with PKCE verifier)
 *   6. Fetch FHIR R4 resources
 *   7. Save JSON files + generate Markdown summary
 */

const dotenv = require('dotenv');
const crypto = require('crypto');
const http = require('http');
const { URL, URLSearchParams } = require('url');
const fs = require('fs');
const path = require('path');
const express = require('express');

dotenv.config({ path: path.join(__dirname, '.env') });

// ═══════════════ CONFIGURATION ═══════════════

const CONFIG = {
  clientId: process.env.EPIC_CLIENT_ID,
  fhirBaseUrl: (process.env.EPIC_FHIR_BASE_URL || '').replace(/\/+$/, ''),
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback',
  port: parseInt(process.env.PORT, 10) || 3000,
  outputDir: path.join(process.cwd(), 'output'),
  scopes: [
    'openid',
    'fhirUser',
    'patient/Patient.read',
    'patient/Condition.read',
    'patient/Observation.read',
    'patient/MedicationRequest.read',
    'patient/DiagnosticReport.read',
    'patient/Encounter.read',
    'patient/AllergyIntolerance.read',
    'patient/Immunization.read',
    'patient/DocumentReference.read',
  ].join(' '),
};

function validateConfig() {
  if (!CONFIG.clientId) {
    console.error('Error: EPIC_CLIENT_ID is required. Set it in .env');
    process.exit(1);
  }
  if (!CONFIG.fhirBaseUrl) {
    console.error('Error: EPIC_FHIR_BASE_URL is required. Set it in .env');
    process.exit(1);
  }
}

// ═══════════════ PKCE UTILITIES ═══════════════

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ═══════════════ SMART DISCOVERY ═══════════════

async function discoverEndpoints(fhirBaseUrl) {
  console.log('Discovering SMART endpoints...');

  // Try .well-known/smart-configuration first
  const smartConfigUrl = `${fhirBaseUrl}/.well-known/smart-configuration`;
  try {
    const resp = await fetch(smartConfigUrl);
    if (resp.ok) {
      const config = await resp.json();
      console.log('  Found via .well-known/smart-configuration');
      return {
        authorizationEndpoint: config.authorization_endpoint,
        tokenEndpoint: config.token_endpoint,
      };
    }
  } catch {
    // Fall through to metadata
  }

  // Fallback: FHIR metadata (CapabilityStatement)
  const metadataUrl = `${fhirBaseUrl}/metadata`;
  const resp = await fetch(metadataUrl, {
    headers: { Accept: 'application/fhir+json' },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch FHIR metadata: ${resp.status} ${resp.statusText}`);
  }

  const metadata = await resp.json();
  const security = metadata.rest?.[0]?.security;
  const oauthExt = security?.extension?.find(
    (e) => e.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
  );

  if (!oauthExt) {
    throw new Error('Could not find OAuth endpoints in FHIR server metadata');
  }

  const authEndpoint = oauthExt.extension?.find((e) => e.url === 'authorize')?.valueUri;
  const tokenEndpoint = oauthExt.extension?.find((e) => e.url === 'token')?.valueUri;

  if (!authEndpoint || !tokenEndpoint) {
    throw new Error('OAuth authorize/token endpoints not found in metadata');
  }

  console.log('  Found via FHIR CapabilityStatement metadata');
  return { authorizationEndpoint: authEndpoint, tokenEndpoint: tokenEndpoint };
}

// ═══════════════ OAUTH + PKCE FLOW ═══════════════

async function exchangeCodeForToken(tokenEndpoint, code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CONFIG.redirectUri,
    client_id: CONFIG.clientId,
    code_verifier: codeVerifier,
  });

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${errText}`);
  }

  return resp.json();
}

// ═══════════════ FHIR RESOURCE FETCHING ═══════════════

async function fetchFhirResource(fhirBaseUrl, resourceType, accessToken, patientId, params = {}) {
  const url = new URL(`${fhirBaseUrl}/${resourceType}`);

  // For Patient, fetch by ID directly
  if (resourceType === 'Patient') {
    const directUrl = `${fhirBaseUrl}/Patient/${patientId}`;
    const resp = await fetch(directUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/fhir+json',
      },
    });
    if (!resp.ok) {
      console.warn(`  Warning: Failed to fetch ${resourceType}: ${resp.status}`);
      return null;
    }
    return resp.json();
  }

  // For other resources, search by patient
  url.searchParams.set('patient', patientId);
  url.searchParams.set('_count', '100');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });

  if (!resp.ok) {
    console.warn(`  Warning: Failed to fetch ${resourceType}: ${resp.status}`);
    return null;
  }

  return resp.json();
}

async function fetchAllResources(fhirBaseUrl, accessToken, patientId) {
  console.log(`\nFetching FHIR resources for patient ${patientId}...\n`);

  const resourceConfigs = [
    { type: 'Patient', filename: 'patient.json' },
    { type: 'Condition', filename: 'conditions.json', params: { _sort: '-recorded-date' } },
    { type: 'Observation', filename: 'observations.json', params: { category: 'laboratory', _sort: '-date', _count: '200' } },
    { type: 'MedicationRequest', filename: 'medication-requests.json', params: { _sort: '-authoredon' } },
    { type: 'DiagnosticReport', filename: 'diagnostic-reports.json', params: { _sort: '-date' } },
    { type: 'Encounter', filename: 'encounters.json', params: { _sort: '-date' } },
    { type: 'AllergyIntolerance', filename: 'allergy-intolerances.json' },
    { type: 'Immunization', filename: 'immunizations.json', params: { _sort: '-date' } },
    { type: 'DocumentReference', filename: 'document-references.json', params: { _sort: '-date' } },
  ];

  const results = {};

  for (const rc of resourceConfigs) {
    process.stdout.write(`  Fetching ${rc.type}...`);
    try {
      const data = await fetchFhirResource(fhirBaseUrl, rc.type, accessToken, patientId, rc.params || {});
      if (data) {
        results[rc.type] = data;
        const count = rc.type === 'Patient' ? 1 : (data.entry?.length || 0);
        console.log(` ${count} record(s)`);
      } else {
        results[rc.type] = null;
        console.log(' (not available)');
      }
    } catch (err) {
      console.log(` Error: ${err.message}`);
      results[rc.type] = null;
    }
  }

  return { results, resourceConfigs };
}

// ═══════════════ FILE OUTPUT ═══════════════

function saveJsonFiles(outputDir, results, resourceConfigs) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const rc of resourceConfigs) {
    const data = results[rc.type];
    if (data) {
      const filePath = path.join(outputDir, rc.filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  Saved ${rc.filename}`);
    }
  }
}

// ═══════════════ MARKDOWN SUMMARY GENERATION ═══════════════

function extractEntries(bundle) {
  if (!bundle || !bundle.entry) return [];
  return bundle.entry.map((e) => e.resource).filter(Boolean);
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function generateMarkdownSummary(results) {
  const lines = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push('# Patient Summary');
  lines.push(`\n_Generated on ${now} by mychart-reader_\n`);

  // ── Demographics ──
  lines.push('## Demographics\n');
  const pt = results.Patient;
  if (pt) {
    const name = pt.name?.[0];
    const fullName = name
      ? [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ')
      : 'Unknown';
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Name** | ${fullName} |`);
    lines.push(`| **Date of Birth** | ${formatDate(pt.birthDate)} |`);
    lines.push(`| **Gender** | ${pt.gender || 'N/A'} |`);
    lines.push(`| **MRN** | ${pt.identifier?.find((i) => i.type?.coding?.[0]?.code === 'MR')?.value || 'N/A'} |`);

    const addr = pt.address?.[0];
    if (addr) {
      const addrStr = [addr.line?.join(', '), addr.city, addr.state, addr.postalCode, addr.country]
        .filter(Boolean).join(', ');
      lines.push(`| **Address** | ${addrStr} |`);
    }

    const phone = pt.telecom?.find((t) => t.system === 'phone');
    if (phone) lines.push(`| **Phone** | ${phone.value} |`);
    const email = pt.telecom?.find((t) => t.system === 'email');
    if (email) lines.push(`| **Email** | ${email.value} |`);

    lines.push(`| **Language** | ${pt.communication?.[0]?.language?.text || 'N/A'} |`);
  } else {
    lines.push('_Patient demographics not available._\n');
  }

  // ── Diagnoses ──
  lines.push('\n## Diagnoses\n');
  const conditions = extractEntries(results.Condition);
  if (conditions.length > 0) {
    lines.push('| Condition | Status | Onset | Code |');
    lines.push('|-----------|--------|-------|------|');
    for (const c of conditions) {
      const display = c.code?.coding?.[0]?.display || c.code?.text || 'Unknown';
      const status = c.clinicalStatus?.coding?.[0]?.code || 'N/A';
      const onset = formatDate(c.onsetDateTime || c.recordedDate);
      const code = c.code?.coding?.[0]?.code || '';
      lines.push(`| ${display} | ${status} | ${onset} | ${code} |`);
    }
  } else {
    lines.push('_No conditions on file._\n');
  }

  // ── Allergies ──
  lines.push('\n## Allergies\n');
  const allergies = extractEntries(results.AllergyIntolerance);
  if (allergies.length > 0) {
    lines.push('| Allergen | Reaction | Severity | Status |');
    lines.push('|----------|----------|----------|--------|');
    for (const a of allergies) {
      const allergen = a.code?.coding?.[0]?.display || a.code?.text || 'Unknown';
      const reaction = a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display || 'N/A';
      const severity = a.reaction?.[0]?.severity || 'N/A';
      const status = a.clinicalStatus?.coding?.[0]?.code || 'N/A';
      lines.push(`| ${allergen} | ${reaction} | ${severity} | ${status} |`);
    }
  } else {
    lines.push('_No allergies on file._\n');
  }

  // ── Current Medications ──
  lines.push('\n## Current Medications\n');
  const meds = extractEntries(results.MedicationRequest);
  if (meds.length > 0) {
    lines.push('| Medication | Dosage | Status | Prescribed |');
    lines.push('|------------|--------|--------|------------|');
    for (const m of meds) {
      const name = m.medicationCodeableConcept?.coding?.[0]?.display
        || m.medicationCodeableConcept?.text
        || m.medicationReference?.display
        || 'Unknown';
      const dosage = m.dosageInstruction?.[0]?.text || 'N/A';
      const status = m.status || 'N/A';
      const date = formatDate(m.authoredOn);
      lines.push(`| ${name} | ${dosage} | ${status} | ${date} |`);
    }
  } else {
    lines.push('_No medications on file._\n');
  }

  // ── Recent Lab Results ──
  lines.push('\n## Recent Lab Results\n');
  const observations = extractEntries(results.Observation);
  const labs = observations.filter((o) => {
    const cats = o.category || [];
    return cats.some((c) => c.coding?.some((cd) => cd.code === 'laboratory'));
  });

  if (labs.length > 0) {
    lines.push('| Test | Value | Unit | Reference Range | Date | Status |');
    lines.push('|------|-------|------|-----------------|------|--------|');

    // Highlight liver function tests
    const liverCodes = new Set([
      '1742-6',  // ALT
      '1920-8',  // AST
      '6768-6',  // ALP
      '1975-2',  // Bilirubin total
      '1968-7',  // Bilirubin direct
      '2885-2',  // Total protein
      '1751-7',  // Albumin
      '6690-2',  // GGT
    ]);

    // Sort: liver function tests first, then by date desc
    const sortedLabs = [...labs].sort((a, b) => {
      const aIsLiver = a.code?.coding?.some((c) => liverCodes.has(c.code)) ? 0 : 1;
      const bIsLiver = b.code?.coding?.some((c) => liverCodes.has(c.code)) ? 0 : 1;
      if (aIsLiver !== bIsLiver) return aIsLiver - bIsLiver;
      const aDate = a.effectiveDateTime || '';
      const bDate = b.effectiveDateTime || '';
      return bDate.localeCompare(aDate);
    });

    for (const lab of sortedLabs.slice(0, 50)) {
      const testName = lab.code?.coding?.[0]?.display || lab.code?.text || 'Unknown';
      let value = 'N/A';
      if (lab.valueQuantity) {
        value = `${lab.valueQuantity.value}`;
      } else if (lab.valueString) {
        value = lab.valueString;
      } else if (lab.valueCodeableConcept) {
        value = lab.valueCodeableConcept.text || lab.valueCodeableConcept.coding?.[0]?.display || 'N/A';
      }
      const unit = lab.valueQuantity?.unit || lab.valueQuantity?.code || '';
      const refRange = lab.referenceRange?.[0]?.text
        || (lab.referenceRange?.[0]?.low && lab.referenceRange?.[0]?.high
          ? `${lab.referenceRange[0].low.value}-${lab.referenceRange[0].high.value}`
          : '')
        || '';
      const date = formatDate(lab.effectiveDateTime);
      const status = lab.status || '';
      const isLiver = lab.code?.coding?.some((c) => liverCodes.has(c.code));
      const prefix = isLiver ? '**' : '';
      const suffix = isLiver ? '** 🔬' : '';
      lines.push(`| ${prefix}${testName}${suffix} | ${value} | ${unit} | ${refRange} | ${date} | ${status} |`);
    }

    if (sortedLabs.length > 50) {
      lines.push(`\n_...and ${sortedLabs.length - 50} more lab results (see observations.json)_\n`);
    }
  } else {
    lines.push('_No lab results on file._\n');
  }

  // ── Diagnostic Reports ──
  lines.push('\n## Diagnostic Reports (MRI, EEG, etc.)\n');
  const reports = extractEntries(results.DiagnosticReport);
  if (reports.length > 0) {
    for (const r of reports) {
      const title = r.code?.coding?.[0]?.display || r.code?.text || 'Report';
      const date = formatDate(r.effectiveDateTime || r.issued);
      const status = r.status || 'N/A';
      lines.push(`### ${title}`);
      lines.push(`- **Date:** ${date}`);
      lines.push(`- **Status:** ${status}`);
      if (r.conclusion) {
        lines.push(`- **Conclusion:** ${r.conclusion}`);
      }
      if (r.presentedForm?.[0]?.data) {
        lines.push(`- _Attached document available (base64 encoded in JSON)_`);
      }
      lines.push('');
    }
  } else {
    lines.push('_No diagnostic reports on file._\n');
  }

  // ── Recent Visits ──
  lines.push('\n## Recent Visits\n');
  const encounters = extractEntries(results.Encounter);
  if (encounters.length > 0) {
    lines.push('| Date | Type | Reason | Status | Location |');
    lines.push('|------|------|--------|--------|----------|');
    for (const enc of encounters.slice(0, 20)) {
      const date = formatDate(enc.period?.start);
      const type = enc.type?.[0]?.coding?.[0]?.display || enc.type?.[0]?.text || 'N/A';
      const reason = enc.reasonCode?.[0]?.coding?.[0]?.display || enc.reasonCode?.[0]?.text || '';
      const status = enc.status || 'N/A';
      const location = enc.location?.[0]?.location?.display || '';
      lines.push(`| ${date} | ${type} | ${reason} | ${status} | ${location} |`);
    }
    if (encounters.length > 20) {
      lines.push(`\n_...and ${encounters.length - 20} more encounters (see encounters.json)_\n`);
    }
  } else {
    lines.push('_No visit history on file._\n');
  }

  // ── Immunizations ──
  lines.push('\n## Immunizations\n');
  const immunizations = extractEntries(results.Immunization);
  if (immunizations.length > 0) {
    lines.push('| Vaccine | Date | Status |');
    lines.push('|---------|------|--------|');
    for (const imm of immunizations) {
      const vaccine = imm.vaccineCode?.coding?.[0]?.display || imm.vaccineCode?.text || 'Unknown';
      const date = formatDate(imm.occurrenceDateTime);
      const status = imm.status || 'N/A';
      lines.push(`| ${vaccine} | ${date} | ${status} |`);
    }
  } else {
    lines.push('_No immunization records on file._\n');
  }

  // ── Documents ──
  lines.push('\n## Clinical Documents\n');
  const docs = extractEntries(results.DocumentReference);
  if (docs.length > 0) {
    lines.push('| Document | Type | Date | Status |');
    lines.push('|----------|------|------|--------|');
    for (const doc of docs) {
      const desc = doc.description || doc.type?.coding?.[0]?.display || doc.type?.text || 'Document';
      const docType = doc.category?.[0]?.coding?.[0]?.display || '';
      const date = formatDate(doc.date || doc.context?.period?.start);
      const status = doc.status || 'N/A';
      lines.push(`| ${desc} | ${docType} | ${date} | ${status} |`);
    }
  } else {
    lines.push('_No clinical documents on file._\n');
  }

  lines.push('\n---');
  lines.push('_This summary was auto-generated from FHIR R4 resources. Consult your healthcare provider for medical advice._\n');

  return lines.join('\n');
}

// ═══════════════ MAIN CLI FLOW ═══════════════

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║       mychart-reader v1.0.0          ║');
  console.log('║  SMART on FHIR Patient Data Export   ║');
  console.log('╚══════════════════════════════════════╝\n');

  validateConfig();

  // Step 1: Discover endpoints
  const { authorizationEndpoint, tokenEndpoint } = await discoverEndpoints(CONFIG.fhirBaseUrl);
  console.log(`  Authorization: ${authorizationEndpoint}`);
  console.log(`  Token:         ${tokenEndpoint}`);

  // Step 2: Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Step 3: Build authorization URL
  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CONFIG.clientId);
  authUrl.searchParams.set('redirect_uri', CONFIG.redirectUri);
  authUrl.searchParams.set('scope', CONFIG.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('aud', CONFIG.fhirBaseUrl);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Step 4: Start local callback server + open browser
  const { code, receivedState } = await startCallbackServerAndAuth(authUrl.toString(), state);

  // Verify state
  if (receivedState !== state) {
    console.error('Error: OAuth state mismatch. Possible CSRF attack.');
    process.exit(1);
  }

  console.log('\nAuthorization code received. Exchanging for access token...');

  // Step 5: Exchange code for token
  const tokenResponse = await exchangeCodeForToken(tokenEndpoint, code, codeVerifier);
  const accessToken = tokenResponse.access_token;
  const patientId = tokenResponse.patient;

  if (!accessToken) {
    console.error('Error: No access token in token response.');
    process.exit(1);
  }
  if (!patientId) {
    console.error('Error: No patient ID in token response. The server may not support patient launch context.');
    process.exit(1);
  }

  console.log(`Access token obtained. Patient ID: ${patientId}`);

  // Step 6: Fetch all FHIR resources
  const { results, resourceConfigs } = await fetchAllResources(CONFIG.fhirBaseUrl, accessToken, patientId);

  // Step 7: Save JSON files
  console.log(`\nSaving data to ${CONFIG.outputDir}/\n`);
  saveJsonFiles(CONFIG.outputDir, results, resourceConfigs);

  // Step 8: Generate Markdown summary
  const markdown = generateMarkdownSummary(results);
  const mdPath = path.join(CONFIG.outputDir, 'patient-summary.md');
  fs.writeFileSync(mdPath, markdown);
  console.log(`  Saved patient-summary.md`);

  console.log('\nDone! Your patient data has been exported to ./output/');
  console.log('Open output/patient-summary.md for a readable summary.\n');
}

// ═══════════════ CALLBACK SERVER ═══════════════

function startCallbackServerAndAuth(authUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const app = express();
    let server;

    app.get('/callback', (req, res) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        res.send(`
          <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e74c3c;">Authorization Failed</h1>
            <p>${error}: ${error_description || 'Unknown error'}</p>
            <p>You can close this window.</p>
          </body></html>
        `);
        server.close();
        reject(new Error(`OAuth error: ${error} — ${error_description}`));
        return;
      }

      if (!code) {
        res.send(`
          <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e74c3c;">Missing Authorization Code</h1>
            <p>No authorization code was received.</p>
          </body></html>
        `);
        server.close();
        reject(new Error('No authorization code in callback'));
        return;
      }

      res.send(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #27ae60;">Authorization Successful</h1>
          <p>You can close this window and return to the terminal.</p>
        </body></html>
      `);

      server.close();
      resolve({ code, receivedState: state });
    });

    server = app.listen(CONFIG.port, async () => {
      console.log(`\nCallback server listening on port ${CONFIG.port}`);
      console.log('Opening browser for MyChart login...\n');

      try {
        const open = (await import('open')).default;
        await open(authUrl);
      } catch {
        console.log('Could not open browser automatically.');
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
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

// ═══════════════ RUN ═══════════════

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
