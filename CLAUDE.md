# CLAUDE.md — MED&გზური (MedGzuri)

## Project Overview

MED&გზური is a Georgian-language medical research navigation service. It helps patients in Georgia find relevant medical research, understand symptoms, and locate appropriate clinics worldwide.

**Core functionality:**

- **Research Guide** — searches medical literature (PubMed, ClinicalTrials.gov, Europe PMC, EU CTR, WHO ICTRP) for a given diagnosis, returns structured results in Georgian
- **Symptom Navigator** — recommends medical tests and specialists based on described symptoms (does NOT diagnose)
- **Clinic Search** — finds hospitals/clinics globally with pricing estimates and treatment details

## Architecture

The system is a **three-tier architecture** with dual frontends and dual backends:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser                                      │
└───────────┬──────────────────────────────┬──────────────────────────┘
            │                              │
            ▼                              ▼
┌───────────────────────┐    ┌──────────────────────────┐
│   Legacy Frontend     │    │   Modern Frontend        │
│   (Vercel Static)     │    │   (Next.js 16)           │
│                       │    │                          │
│ • index.html (landing)│    │ • src/app/page.tsx       │
│ • product.html (search│    │ • ResearchForm.tsx       │
│ • login.html (auth)   │    │ • SymptomsForm.tsx       │
│ • admin.html (admin)  │    │ • ClinicsForm.tsx        │
│ • crm.html (CRM)     │    │ • ResultCard.tsx         │
│ • qa.html (QA)        │    │ • LoadingSteps.tsx       │
│ • chatbot.js          │    │                          │
└───────────┬───────────┘    └──────────┬───────────────┘
            │                           │
            ▼                           ▼
┌───────────────────────┐    ┌──────────────────────────┐
│   Vercel Serverless   │    │   FastAPI Backend         │
│                       │    │   (Railway/Docker)        │
│ • api/search.js       │    │                          │
│ • api/auth.js         │    │ Pipeline A (Research)    │
│ • api/leads.js        │    │   A1→A2‖A3→A4→A5        │
│ • api/qa.js           │    │                          │
│                       │    │ Pipeline B (Symptoms)    │
│ lib/security.js       │    │   B1→B2→B3→B4           │
│ lib/supabase.js       │    │                          │
│                       │    │ Pipeline C (Clinics)     │
└──┬────────┬───────────┘    │   C1→C2‖C3‖C4→C5       │
   │        │                └──┬───────┬──────────────┘
   │        │                   │       │
   ▼        ▼                   ▼       ▼
┌──────┐ ┌──────────┐    ┌──────┐ ┌──────────────────┐
│Perplex│ │ Claude   │    │PubMed│ │ClinicalTrials.gov│
│ity   │ │ Sonnet   │    │      │ │Europe PMC        │
│sonar │ │          │    │      │ │EU CTR, WHO ICTRP │
└──────┘ └──────────┘    └──────┘ └──────────────────┘
                │                        │
                ▼                        ▼
         ┌────────────┐          ┌────────────────┐
         │  Supabase   │          │  Redis Cache   │
         │ PostgreSQL  │          │  (Docker)      │
         └────────────┘          └────────────────┘
```

### File Structure

```
MEDgzuri/
├── index.html            # Landing/marketing page (horizontal scroll design)
├── product.html          # Main search interface with 3 tabs
├── login.html            # Authentication UI (Supabase auth)
├── admin.html            # Admin dashboard UI
├── crm.html              # CRM system UI
├── qa.html               # QA audit dashboard (9 teams)
├── chatbot.js            # Rule-based customer support chatbot (Georgian)
├── manifest.json         # PWA manifest
├── icon.svg              # PWA app icon (medical cross + მგ)
├── package.json          # Node.js deps (@supabase/supabase-js)
├── vercel.json           # Vercel deployment and routing
│
├── api/                  # Vercel serverless functions
│   ├── search.js         # Main search: Medical APIs → Claude pipeline (1,200+ lines)
│   ├── auth.js           # Authentication: Supabase auth wrapper
│   ├── leads.js          # Lead management: CRUD via Supabase
│   └── qa.js             # QA audit: 9 specialized quality teams (1,390 lines)
│
├── lib/                  # Shared Node.js utilities
│   ├── security.js       # CORS whitelist, security headers, rate limiting, input sanitization
│   └── supabase.js       # Supabase client singleton (service + public)
│
├── db/
│   └── schema.sql        # Supabase PostgreSQL schema (profiles, leads, search_logs)
│
├── n8n/                  # n8n workflow exports (research, symptoms, clinics)
├── tests/                # Node.js API tests (38 tests)
│
├── medgzuri-backend/     # Python FastAPI backend (Railway/Docker)
│   ├── app/
│   │   ├── main.py           # FastAPI app, /health, POST /api/search
│   │   ├── config.py         # Pydantic settings (env vars)
│   │   ├── database.py       # Async SQLAlchemy engine + sessions
│   │   ├── models/           # SQLAlchemy ORM (search_history, cached_results)
│   │   ├── orchestrator/     # Router + Pydantic schemas
│   │   ├── pipelines/        # A (research), B (symptoms), C (clinics)
│   │   ├── integrations/     # PubMed, ClinicalTrials.gov, Europe PMC, EU CTR, WHO ICTRP
│   │   └── services/         # LLM client, compliance guard, medical terms
│   ├── alembic/              # Database migrations (async PostgreSQL)
│   │   └── versions/         # Migration files
│   ├── docker-compose.yml    # PostgreSQL 16 + Redis 7 + FastAPI
│   ├── Dockerfile
│   ├── requirements.txt
│   └── tests/                # Python tests (129 tests)
│
└── medgzuri-frontend/    # Next.js 16 + React 19 + TypeScript frontend
    ├── src/
    │   ├── app/              # Next.js app router (page.tsx, layout.tsx)
    │   ├── components/       # React components (8 files)
    │   ├── lib/api.ts        # API client
    │   └── types/api.ts      # TypeScript types
    ├── package.json
    └── next.config.ts
```

**Stack:**
- **Legacy Frontend:** Vanilla HTML/CSS/JS on Vercel (no build step)
- **Modern Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4
- **Vercel API:** Node.js serverless functions (search, auth, leads, qa)
- **Backend:** Python FastAPI on Railway/Docker
- **Database:** Supabase PostgreSQL (auth, profiles, leads, search_logs) + local PostgreSQL 16 (search_history, cached_results)
- **Cache:** Redis 7 (Docker, planned integration)
- **Orchestration:** n8n workflows (optional)

### API Pipeline (api/search.js — Vercel)

1. Frontend POSTs to `/api/search` with `{ type, data }`
2. Check LRU cache (100 entries, 30-min TTL)
3. Try n8n webhook pipeline (if configured)
4. Try Railway FastAPI backend (agent-based pipelines)
5. Fallback: Direct medical APIs (PubMed, OpenAlex, ClinicalTrials.gov, Europe PMC) → Claude API (structure + translate to Georgian)
6. Cache result + async Supabase logging

Search types: `research`, `symptoms`, `clinics`, `report`

### FastAPI Backend (medgzuri-backend)

Three pipelines with multi-agent architecture:
- **Pipeline A (Research):** A1 (Term Normalizer) → A2 (PubMed) ‖ A3 (ClinicalTrials) → A4 (Analyzer) → A5 (Report Generator)
- **Pipeline B (Symptoms):** B1 (Symptom Parser) → B2 (Test Recommender) → B3 (Specialist Matcher) → B4 (Report)
- **Pipeline C (Clinics):** C1 (Query Builder) → C2 ‖ C3 ‖ C4 (Search Sources) → C5 (Report)

5 external API integrations: PubMed, ClinicalTrials.gov, Europe PMC, EU CTR, WHO ICTRP

### Shared Security Layer (lib/security.js)

All API endpoints import and use `lib/security.js` which provides:
- CORS origin whitelist (production domains + localhost)
- Security HTTP headers (X-Content-Type-Options, X-Frame-Options, CSP, etc.)
- Rate limiting per endpoint (search: 20/min, auth: 5/min, leads: 10/min)
- Input sanitization (string trimming, control char stripping)
- Email/phone/password validation

## Environment Variables

### Vercel (Node.js API)

```
ANTHROPIC_API_KEY         # Anthropic Claude — analysis and Georgian translation
NCBI_API_KEY              # NCBI/PubMed API key (optional, higher rate limits)
OPENAI_API_KEY            # OpenAI (planned Phase 2 — fact-checking)
N8N_WEBHOOK_BASE_URL      # n8n orchestration webhook URL (optional)
N8N_WEBHOOK_SECRET        # n8n webhook authentication secret
SUPABASE_URL              # Supabase project URL
SUPABASE_SERVICE_KEY      # Supabase service role key (server-side)
SUPABASE_ANON_KEY         # Supabase anonymous key (client-side)
RAILWAY_BACKEND_URL       # Railway FastAPI backend URL
ALLOWED_ORIGINS           # Comma-separated CORS origins (optional override)
```

### Railway / Docker (Python Backend)

```
ANTHROPIC_API_KEY         # Anthropic Claude — LLM pipelines
NCBI_API_KEY              # NCBI/PubMed API key (optional, higher rate limits)
DATABASE_URL              # PostgreSQL connection (asyncpg)
REDIS_URL                 # Redis connection
DEEPL_API_KEY             # DeepL translation (optional)
ALLOWED_ORIGINS           # CORS origins
```

### Supabase

Configured via Supabase dashboard. Schema defined in `db/schema.sql` with RLS policies.

## Development

### Running Locally

**Frontend (Legacy):** Open HTML files directly in a browser. No build step.

**Frontend (Next.js):**
```bash
cd medgzuri-frontend && npm install && npm run dev
```

**Vercel API:** Requires Vercel CLI + env vars:
```bash
npm install && vercel dev
```

**FastAPI Backend:**
```bash
cd medgzuri-backend
docker-compose up -d   # PostgreSQL + Redis
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Database Migrations

```bash
cd medgzuri-backend
alembic upgrade head        # Apply migrations
alembic revision --autogenerate -m "description"  # New migration
```

### Deployment

- **Vercel:** Push to main branch — auto-deploys HTML, API, and static assets
- **Railway:** Deploy medgzuri-backend via Railway CLI or GitHub integration
- **Supabase:** Managed cloud PostgreSQL — apply schema via dashboard or CLI

### Routes (vercel.json)

| Route | Destination |
|-------|-------------|
| `/api/search` | `api/search.js` |
| `/api/auth` | `api/auth.js` |
| `/api/leads` | `api/leads.js` |
| `/api/qa` | `api/qa.js` |
| `/product` | `product.html` |
| `/login` | `login.html` |
| `/admin` | `admin.html` |
| `/crm` | `crm.html` |
| `/qa` | `qa.html` |

### Testing

**Node.js API tests:**
```bash
npm test    # 38 tests
```

**Python backend tests:**
```bash
cd medgzuri-backend
pytest      # 129 tests (requires pytest-httpx for integration tests)
```

## Code Conventions

### Language

- **UI text:** Georgian throughout (UTF-8, Noto Sans Georgian font)
- **Code comments:** Mixed Georgian/English
- **Variable/function names:** English

### Naming

- **JavaScript functions/variables:** camelCase (`startSearch`, `displayResults`)
- **Python functions/variables:** snake_case (`search_research`, `pipeline_type`)
- **CSS classes:** BEM-inspired kebab-case (`.result-card`, `.form-group`)
- **HTML IDs:** kebab-case (`research-diagnosis`, `chatbot-widget`)

### Claude Models

- **Vercel API (search.js):** `claude-sonnet-4-6`
- **FastAPI Backend:** Sonnet `claude-sonnet-4-6`, Opus `claude-opus-4-6`

### Code Style

- Legacy HTML: Inline `<style>` and `<script>` blocks (no external bundles except chatbot.js)
- Next.js: Tailwind CSS v4, TypeScript, React hooks
- Python: Type hints, async/await, Pydantic models
- Section separators in JS: `// ═══════════════ SECTION ═══════════════`

## Key Patterns

### Graceful Degradation

The system has multiple fallback layers:
1. n8n pipeline → Railway FastAPI → direct medical APIs + Claude → demo data
2. If Claude fails → raw API results
3. If Supabase unavailable → features degrade without DB
4. If Redis unavailable → in-memory caching
5. Demo mode when API keys are not configured

### API Response Format

```json
{
  "meta": "Summary string",
  "items": [
    {
      "title": "Result title",
      "source": "Source/location",
      "body": "Detailed description",
      "tags": ["tag1", "tag2"],
      "url": "https://source-link.com"
    }
  ],
  "summary": "Optional text summary (fallback)"
}
```

### Medical Safety

- Compliance guard checks all LLM outputs for diagnosis/prescription language
- Disclaimer displayed on every response
- System recommends tests and specialists only — never diagnoses

## Important Notes for AI Assistants

- **Georgian language:** All user-facing text must be in Georgian (UTF-8). Font: Noto Sans Georgian.
- **Medical safety:** Never generate content that could be interpreted as medical diagnosis.
- **Dual frontend:** Vanilla HTML (Vercel) and Next.js (Railway) coexist. Both are active.
- **lib/security.js:** All API endpoints import shared security middleware. Do not duplicate CORS/rate-limiting logic inline.
- **No inline CORS:** CORS is handled by `lib/security.js` via `setCorsHeaders()` and `setSecurityHeaders()`.
- **CORS policy:** Whitelist-based (not `*`). Production domains + localhost configured in `lib/security.js`.
- **Currency:** Georgian Lari (₾)
- **Docker:** Backend uses `docker-compose.yml` with PostgreSQL 16 + Redis 7.
- **Alembic:** Async migrations via asyncpg. Run from `medgzuri-backend/`.
