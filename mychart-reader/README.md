# mychart-reader

CLI tool to export your patient data from MyChart (Epic) via SMART on FHIR with PKCE authentication.

## Setup

### 1. Register a SMART on FHIR App

Go to [Epic's Developer Portal](https://fhir.epic.com/) and register a new application:

- **Application Type:** Patient-facing
- **FHIR Version:** R4
- **Auth Flow:** Authorization Code with PKCE
- **Redirect URI:** `http://localhost:3000/callback`
- **No client secret** (public client)

Request these scopes:
- `patient/Patient.read`
- `patient/Condition.read`
- `patient/Observation.read`
- `patient/MedicationRequest.read`
- `patient/DiagnosticReport.read`
- `patient/Encounter.read`
- `patient/AllergyIntolerance.read`
- `patient/Immunization.read`
- `patient/DocumentReference.read`

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your client ID and FHIR base URL:

```
EPIC_CLIENT_ID=your-client-id-here
EPIC_FHIR_BASE_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
```

Common FHIR base URLs:
- **Epic Sandbox:** `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`
- **MyChart (production):** Varies by institution — check your hospital's developer docs

### 3. Install & Run

```bash
cd mychart-reader
npm install
npm start
```

The tool will:
1. Discover your FHIR server's OAuth endpoints
2. Open your browser for MyChart login
3. After you authenticate, fetch your medical records
4. Save everything to `./output/`

## Output

```
output/
├── patient.json              # Demographics
├── conditions.json           # Diagnoses
├── observations.json         # Lab results
├── medication-requests.json  # Current medications
├── diagnostic-reports.json   # MRI, EEG reports
├── encounters.json           # Visit history
├── allergy-intolerances.json # Allergies
├── immunizations.json        # Vaccination records
├── document-references.json  # Clinical documents
└── patient-summary.md        # Human-readable summary
```

## How It Works

1. **SMART Discovery** — fetches `.well-known/smart-configuration` or FHIR `metadata` to find OAuth endpoints
2. **PKCE Auth** — generates code_verifier/code_challenge, opens browser for patient authorization
3. **Token Exchange** — exchanges authorization code + PKCE verifier for access token
4. **FHIR Fetch** — retrieves 9 resource types from the FHIR R4 API
5. **Export** — saves raw JSON + generates a Markdown summary with tables

## Security

- Uses PKCE (Proof Key for Code Exchange) — no client secret stored
- Access tokens are kept in memory only, never written to disk
- All data is saved locally to `./output/`
