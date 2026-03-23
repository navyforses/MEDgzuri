# mychart-reader

CLI tool to export patient health data from Boston Medical Center's Epic MyChart
via SMART on FHIR with PKCE authentication.

No client secret needed — this is a public SMART on FHIR client.

## Setup

### 1. Configure

```bash
cp .env.example .env
```

The `.env` file comes pre-configured with BMC's non-production client ID and
Epic's sandbox FHIR URL for testing.

**Client IDs (already in .env):**
- Non-Production: `eb2d7820-3ffc-48f5-8da4-0461bd04c6b8`
- Production: `e67663ad-bf66-4771-aa6c-42a5f3848bf2`

**FHIR Base URLs (tried in order if primary fails):**
1. Your configured `FHIR_BASE_URL`
2. `https://fhir.bmc.org/FHIR/api/FHIR/R4`
3. `https://mychart.bmc.org/FHIR/api/FHIR/R4`
4. `https://mychart.bmc.org/interconnect-prd-fhir/api/FHIR/R4`
5. `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` (sandbox)

### 2. Install & Run

```bash
cd mychart-reader
npm install
npm start
```

### What happens:
1. Discovers SMART OAuth endpoints from the FHIR server
2. Opens your browser for MyChart login
3. You authenticate with your MyChart credentials
4. Tool fetches your medical records via FHIR R4 API
5. Saves everything to `./output/`
6. Prints a summary to the console

## Output

```
output/
├── patient.json              # Demographics, MRN
├── conditions.json           # All diagnoses
├── observations.json         # Lab results (ALT, AST, GGT, bilirubin, etc.)
├── medication-requests.json  # Current medications
├── diagnostic-reports.json   # MRI, EEG reports
├── encounters.json           # Visits (last 12 months)
├── allergy-intolerances.json # Allergies
├── immunizations.json        # Vaccination records
├── procedures.json           # Procedures
├── document-references.json  # Clinical notes/documents
└── patient-summary.md        # Human-readable Markdown summary
```

### patient-summary.md sections

- **Demographics** — Name, DOB, MRN, Gender
- **Active Diagnoses** — Code, Description, Onset Date
- **Allergies** — Allergen, Reaction, Severity
- **Current Medications** — Drug, Dose, Frequency, Status
- **Lab Results** — Test, Value, Units, Range, Date, Flag (abnormal values marked with ⚠️)
- **Diagnostic Reports** — MRI, EEG, imaging
- **Recent Encounters** — Date, Type, Provider, Department
- **Immunizations** — Vaccine, Date, Status
- **Procedures** — Procedure, Date, Status
- **Documents Available** — Clinical notes, Category, Format

## SMART on FHIR Flow

```
1. Discover endpoints    GET /.well-known/smart-configuration
                         (fallback: GET /metadata)

2. Browser auth          → authorize?response_type=code
                           &client_id=...
                           &redirect_uri=http://localhost:3000/callback
                           &scope=openid fhirUser launch/patient patient/*.read
                           &code_challenge=<S256 hash>&code_challenge_method=S256
                           &aud=<fhir-base-url>&state=<random>

3. User logs in          MyChart credentials in browser

4. Callback              GET /callback?code=<auth-code>&state=<state>

5. Token exchange        POST /token  (code + code_verifier, no client_secret)

6. Fetch resources       GET /Patient/<id>, /Condition?patient=<id>, etc.
```

## Error Handling

- If a FHIR base URL fails, the tool automatically tries the next URL in the list
- All HTTP requests are logged with status codes for debugging
- Individual resource fetch failures are handled gracefully (other resources still fetched)
- 5-minute timeout on the OAuth flow

## Security

- PKCE (Proof Key for Code Exchange) — 128-character code_verifier, no client secret
- Access tokens kept in memory only, never written to disk
- OAuth state parameter verified to prevent CSRF
- All data saved locally to `./output/`
