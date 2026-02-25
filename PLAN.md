# MedGzuri Backend — Agent Orchestra Architecture
## Implementation Plan

---

## Overview

Complete backend rebuild: replacing the current single-file `api/search.js` (Perplexity → Claude pipeline) with a Python/FastAPI agent orchestration system. The new system uses specialized AI agents organized into three pipelines (Research, Symptoms, Clinics) with shared services.

**Current state:** Single `api/search.js` file (~1120 lines) with Perplexity web search → Claude analysis pipeline, deployed as Vercel serverless function.

**Target state:** Python FastAPI backend with Docker deployment, multi-agent pipelines, direct API integrations (ClinicalTrials.gov, PubMed, Europe PMC), and structured report generation.

---

## Key Decision: Frontend Compatibility

The frontend (`product.html`) currently sends requests to `/api/search` with `{ type, data }`. The new backend must:

1. Accept the **same request format** from the frontend OR
2. Provide a **new endpoint** that the frontend will be updated to call

**Plan:** Create a new `/api/search` POST endpoint in FastAPI that accepts the existing `{ type, data }` format AND the new `{ source_tab, ... }` format. This ensures backward compatibility while enabling the new architecture. The orchestrator will map:
- `type: "research"` → `source_tab: "research_search"` → Pipeline A
- `type: "symptoms"` → `source_tab: "symptom_navigation"` → Pipeline B
- `type: "clinics"` → `source_tab: "clinic_search"` → Pipeline C

**Frontend changes:** Minimal — update the API endpoint URL in `product.html` if the backend runs on a different port/domain.

---

## File Structure

```
medgzuri-backend/
├── docker-compose.yml          # PostgreSQL + Redis + FastAPI
├── Dockerfile                  # Python 3.12 image
├── requirements.txt            # All Python dependencies
├── .env.example                # Template for environment variables
├── pytest.ini                  # Pytest configuration
│
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app, CORS, lifespan, /api/search endpoint
│   ├── config.py               # Pydantic Settings (env vars, model names)
│   │
│   ├── orchestrator/
│   │   ├── __init__.py
│   │   ├── router.py           # Orchestrator: validate → classify → route to pipeline
│   │   └── schemas.py          # ALL Pydantic models (input/output for every agent)
│   │
│   ├── pipelines/
│   │   ├── __init__.py
│   │   ├── research/           # Pipeline A — Research Search
│   │   │   ├── __init__.py
│   │   │   ├── term_normalizer.py     # A1: Georgian → English medical terms, MeSH, ICD-10
│   │   │   ├── clinical_trials.py     # A2: ClinicalTrials.gov + EU CTR + WHO ICTRP queries
│   │   │   ├── literature_search.py   # A3: PubMed + Europe PMC search & summarize
│   │   │   ├── aggregator.py          # A4: Merge A2+A3, dedup, relevance scoring (0-100)
│   │   │   └── report_generator.py    # A5: Generate structured Georgian report (Opus)
│   │   │
│   │   ├── symptoms/           # Pipeline B — Symptom Navigation
│   │   │   ├── __init__.py
│   │   │   ├── symptom_parser.py      # B1: Extract symptoms, translate, contextualize
│   │   │   ├── differential.py        # B2: Research directions (NOT diagnosis) — Opus
│   │   │   ├── research_matcher.py    # B3: Reuse A1→A2+A3→A4 with patient filters
│   │   │   └── navigator_report.py    # B4: Patient-facing Georgian report — Opus
│   │   │
│   │   └── clinics/            # Pipeline C — Clinic Search
│   │       ├── __init__.py
│   │       ├── query_builder.py       # C1: Term normalization + filter preparation
│   │       ├── clinic_finder.py       # C2: Search clinics (ClinicalTrials.gov sites, web)
│   │       ├── rating_agent.py        # C3: JCI, rankings, publication count
│   │       ├── cost_agent.py          # C4: Pricing, visa, travel cost estimates
│   │       └── clinic_report.py       # C5: Ranked clinic report — Opus
│   │
│   ├── services/               # Shared Services
│   │   ├── __init__.py
│   │   ├── llm_client.py             # Anthropic SDK wrapper (Sonnet + Opus)
│   │   ├── translation.py            # S1: Georgian ↔ English medical translation
│   │   ├── cache.py                   # S2: Redis cache (24h/7d/30d TTL by source)
│   │   ├── source_tracker.py          # S3: URL tracking for every fact
│   │   └── compliance_guard.py        # S4: Final output validation (no diagnosis, disclaimer)
│   │
│   ├── integrations/           # External API clients
│   │   ├── __init__.py
│   │   ├── clinicaltrials_gov.py      # ClinicalTrials.gov REST API v2
│   │   ├── pubmed.py                  # PubMed E-utilities (esearch + efetch)
│   │   ├── europe_pmc.py             # Europe PMC REST API
│   │   ├── eu_ctr.py                  # EU Clinical Trials Register
│   │   └── who_ictrp.py              # WHO ICTRP (best-effort, limited API)
│   │
│   ├── models/                 # SQLAlchemy ORM models
│   │   ├── __init__.py
│   │   ├── base.py                    # Base, engine, session factory
│   │   ├── search_history.py          # Search log table
│   │   └── cached_results.py          # Persistent cache table
│   │
│   └── utils/
│       ├── __init__.py
│       ├── medical_terms.py           # Georgian-English medical term dictionary
│       └── country_data.py            # Visa info, distances, cost benchmarks for GE patients
│
└── tests/
    ├── __init__.py
    ├── conftest.py                    # Shared fixtures (mock LLM, mock APIs)
    ├── test_orchestrator.py
    ├── test_pipeline_research.py
    ├── test_pipeline_symptoms.py
    ├── test_pipeline_clinics.py
    ├── test_integrations.py
    └── test_services.py
```

---

## Implementation Order (Step by Step)

### Stage 1: Foundation (files 1-7)

**Step 1.1** — Project scaffolding
- Create `medgzuri-backend/` directory
- Create `requirements.txt` with pinned versions
- Create `.env.example`
- Create `Dockerfile` (Python 3.12-slim, pip install, uvicorn entrypoint)
- Create `docker-compose.yml` (fastapi + postgres + redis)
- Create all `__init__.py` files

**Step 1.2** — Configuration (`app/config.py`)
- Pydantic `Settings` class reading from environment
- API keys: ANTHROPIC_API_KEY, NCBI_API_KEY, DEEPL_API_KEY
- Model names: CLAUDE_SONNET_MODEL, CLAUDE_OPUS_MODEL (with defaults)
- Database URL, Redis URL
- Rate limit config, cache TTL config

**Step 1.3** — LLM Client (`app/services/llm_client.py`)
- Async Anthropic client wrapper
- Two methods: `call_sonnet(system, user_msg, max_tokens)` and `call_opus(system, user_msg, max_tokens)`
- JSON extraction from LLM output (port the existing `extractJSON` logic)
- Retry logic with exponential backoff
- Token usage logging

**Step 1.4** — Pydantic Schemas (`app/orchestrator/schemas.py`)
- Input models:
  - `SearchRequest` (backward-compatible: accepts `type`+`data` OR `source_tab`+fields)
  - `ResearchInput`, `SymptomsInput`, `ClinicInput`
- Output models for each agent (A1 through C5)
- Final response model matching frontend expectations
- `ResultItem` model with title, source, body, tags, url, priority, rating, price, phase

**Step 1.5** — FastAPI App (`app/main.py`)
- Create FastAPI app with lifespan (init Redis, DB connections)
- CORS middleware
- Rate limiting middleware
- Single POST endpoint: `/api/search`
- Health check endpoint: `GET /health`
- Demo mode when no API keys configured
- Error handling returning Georgian error messages

**Step 1.6** — Orchestrator (`app/orchestrator/router.py`)
- `OrchestratorRouter` class
- `route(request)` method: validate → classify → dispatch to pipeline
- Input validation, language detection, error handling

**Step 1.7** — Verify Stage 1

---

### Stage 2: External API Integrations (files 8-12)

**Step 2.1** — ClinicalTrials.gov (`app/integrations/clinicaltrials_gov.py`)
- REST API v2: `https://clinicaltrials.gov/api/v2/studies`
- Search, filter by geography/age/study type/status
- Parse into structured objects

**Step 2.2** — PubMed E-utilities (`app/integrations/pubmed.py`)
- esearch + efetch two-step process
- XML response parsing with lxml
- Filter: 3 years, publication types

**Step 2.3** — Europe PMC (`app/integrations/europe_pmc.py`)
- REST API for European publications

**Step 2.4** — EU Clinical Trials Register (`app/integrations/eu_ctr.py`)
- CTIS public API, best-effort

**Step 2.5** — WHO ICTRP (`app/integrations/who_ictrp.py`)
- Best-effort, graceful degradation

---

### Stage 3: Pipeline A — Research Search (files 13-18)

**Step 3.1** — Term Normalizer A1
**Step 3.2** — Clinical Trials Agent A2 (parallel API queries, no LLM)
**Step 3.3** — Literature Search Agent A3 (PubMed + Europe PMC + Sonnet summaries)
**Step 3.4** — Aggregator A4 (merge, dedup, score 0-100)
**Step 3.5** — Report Generator A5 (Opus, structured Georgian report)
**Step 3.6** — Pipeline A orchestration (A1 → A2||A3 → A4 → A5)

---

### Stage 4: Pipeline C — Clinic Search (files 19-24)

**Step 4.1** — Query Builder C1
**Step 4.2** — Clinic Finder C2
**Step 4.3** — Rating Agent C3
**Step 4.4** — Cost Agent C4
**Step 4.5** — Clinic Report C5 (Opus)
**Step 4.6** — Pipeline C orchestration (C1 → C2||C3||C4 → C5)

---

### Stage 5: Pipeline B — Symptom Navigation (files 25-29)

**Step 5.1** — Symptom Parser B1
**Step 5.2** — Differential Analysis B2 (Opus, research directions NOT diagnosis)
**Step 5.3** — Research Matcher B3 (reuses Pipeline A components)
**Step 5.4** — Navigator Report B4 (Opus)
**Step 5.5** — Pipeline B orchestration (B1 → B2 → B3 → B4)

---

### Stage 6: Shared Services (files 30-34)

**Step 6.1** — Translation Engine S1
**Step 6.2** — Cache Layer S2 (Redis with TTL per source type)
**Step 6.3** — Source Tracker S3
**Step 6.4** — Compliance Guard S4
**Step 6.5** — Utility files (medical_terms.py, country_data.py)

---

### Stage 7: Database & Docker & Tests (files 35-40)

**Step 7.1** — Database models
**Step 7.2** — Docker configuration
**Step 7.3** — Test suite

---

## Risk Mitigation

1. **External API failures**: Every integration has graceful degradation
2. **LLM failures**: Opus fail → retry with Sonnet → partial results
3. **Long response times**: Parallel execution, aggressive caching
4. **Georgian text quality**: Opus for all user-facing reports
5. **Cost control**: Sonnet for most operations, Opus only for final reports
