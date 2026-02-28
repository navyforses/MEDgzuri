# MED&გზური — ინფრასტრუქტურის დიაგნოსტიკა

**თარიღი:** 2026-02-28
**სტატუსი:** სრული აუდიტი

---

## 1. არქიტექტურის მიმოხილვა

MED&გზური არის **მრავალშრიანი სამედიცინო ძიების პლატფორმა** სამი განცალკევებული კომპონენტით:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    მომხმარებლის ინტერფეისი                          │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────────────────────────┐   │
│  │  Static Site     │    │  Next.js Frontend (v2)               │   │
│  │  (Vercel)        │    │  (medgzuri-frontend/)                │   │
│  │  index/product/  │    │  React 19 + TypeScript + Tailwind    │   │
│  │  login/admin/crm │    │                                      │   │
│  └────────┬─────────┘    └─────────────────┬────────────────────┘   │
│           │                                │                        │
│           ▼                                ▼                        │
│  ┌──────────────────┐    ┌──────────────────────────────────────┐   │
│  │  Vercel Serverless│    │  FastAPI Backend (v2)                │   │
│  │  api/search.js    │    │  (medgzuri-backend/)                │   │
│  │  api/auth.js      │    │  Railway deployment                 │   │
│  │  api/leads.js     │    │  PostgreSQL + Redis                 │   │
│  │  api/qa.js        │    │                                     │   │
│  └────────┬─────────┘    └─────────────────┬────────────────────┘   │
│           │                                │                        │
│           ▼                                ▼                        │
│  ┌──────────────────┐    ┌──────────────────────────────────────┐   │
│  │  n8n Workflows   │    │  გარე სამედიცინო API-ები            │   │
│  │  (მულტი-აგენტი)  │    │  PubMed, ClinicalTrials.gov,        │   │
│  │  3 workflow       │    │  Europe PMC, EU CTR                  │   │
│  └──────────────────┘    └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. ხელოვნური ინტელექტის (AI) სისტემები

### 2.1. Anthropic Claude — ძირითადი AI

| კომპონენტი | მოდელი | Model ID | გამოყენება |
|-----------|--------|----------|-----------|
| **Vercel API** (api/search.js) | Claude Sonnet 4.5 | `claude-sonnet-4-5-20250514` | ძიების შედეგების სტრუქტურირება, ანალიზი, ქართულად თარგმნა |
| **n8n Workflows** | Claude Sonnet 4.5 | `claude-sonnet-4-5-20250514` | ანგარიშების გენერაცია, სიმპტომების ანალიზი, სპეციალისტის რჩევა |
| **FastAPI Backend** (მსუბუქი ამოცანები) | Claude Sonnet 4.6 | `claude-sonnet-4-6` | ტერმინების ნორმალიზება, ლიტერატურის შეჯამება, სკორინგი |
| **FastAPI Backend** (რთული ანგარიშები) | Claude Opus 4.6 | `claude-opus-4-6` | სრული კვლევის ანგარიში, სიმპტომების ანგარიში, კლინიკების შედარება |

**API Endpoint:** `https://api.anthropic.com/v1/messages`
**API Version:** `2023-06-01`
**Environment Variable:** `ANTHROPIC_API_KEY`

**Claude-ს როლები სისტემაში:**
- სამედიცინო კვლევების ანალიზი და სტრუქტურირება
- ქართულ ენაზე თარგმნა (ლიტერატურული ქართული, სამედიცინო რეგისტრი)
- JSON ფორმატში პასუხის გენერაცია
- სამედიცინო ტერმინების ნორმალიზება (ქართულიდან → ინგლისურად)
- MeSH ტერმინებისა და ICD-10 კოდების გენერაცია
- შედეგების რელევანტურობის შეფასება (0-100)
- სიმპტომების პარსინგი და წითელი დროშების (red flags) იდენტიფიკაცია

---

### 2.2. Perplexity AI — ვებ-ძიების AI

| კომპონენტი | მოდელი | Model ID | გამოყენება |
|-----------|--------|----------|-----------|
| **Vercel API** | Sonar | `sonar` | სამედიცინო ინფორმაციის ვებ-ძიება |
| **n8n Research Workflow** | Sonar | `sonar` | 3 პარალელური ძიება (PubMed, კლინიკური კვლევები, მკურნალობა) |
| **n8n Clinics Workflow** | Sonar | `sonar` | 3 პარალელური ძიება (კლინიკები, ფასები, მიმოხილვები) |
| **n8n Symptoms Workflow** | Sonar | `sonar` | 2 პარალელური ძიება (სიმპტომები, ტესტები) |

**API Endpoint:** `https://api.perplexity.ai/chat/completions`
**Temperature:** `0.1` (ფაქტობრივი, დეტერმინისტული პასუხი)
**Environment Variable:** `PERPLEXITY_API_KEY`

**Perplexity-ს როლი:**
- ვებში სამედიცინო ინფორმაციის ძიება
- წყაროების ციტირება (citations)
- PubMed, ClinicalTrials.gov, და სხვა წყაროებიდან მონაცემების მოპოვება

---

### 2.3. OpenAI GPT — დაგეგმილი (Phase 2)

| სტატუსი | გამოყენება |
|---------|-----------|
| **არ არის აქტიური** | ფაქტების შემოწმება და ვერიფიკაცია |

**Environment Variable:** `OPENAI_API_KEY` (კონფიგურირებული, მაგრამ არ გამოიყენება)

---

### 2.4. DeepL — დაგეგმილი (Phase 2)

| სტატუსი | გამოყენება |
|---------|-----------|
| **არ არის აქტიური** | სარეზერვო თარგმანის სერვისი |

**Environment Variable:** `DEEPL_API_KEY` (მხოლოდ backend-ში)

---

### 2.5. ჩატბოტი (chatbot.js) — წესებზე დაფუძნებული

| ტიპი | AI მოდელი |
|------|-----------|
| **Rule-based** | **არ იყენებს AI-ს** |

keyword-matching სისტემა 12+ კატეგორიით. ყველა პასუხი წინასწარ დაწერილია ქართულად.

---

## 3. გარე სამედიცინო API-ები (არა-AI)

### FastAPI Backend-ის პირდაპირი ინტეგრაციები:

| API | Endpoint | აუთენტიფიკაცია | გამოყენება |
|-----|----------|----------------|-----------|
| **PubMed E-utilities (NCBI)** | `eutils.ncbi.nlm.nih.gov` | NCBI API Key (არასავალდებულო) | სამედიცინო ლიტერატურის ძიება, 38M+ სტატია |
| **ClinicalTrials.gov API v2** | `clinicaltrials.gov/api/v2/studies` | არ სჭირდება | აქტიური კლინიკური კვლევების ძიება |
| **Europe PMC** | `ebi.ac.uk/europepmc/webservices/rest/search` | არ სჭირდება | ღია წვდომის სამედიცინო ლიტერატურა |
| **EU Clinical Trials Register** | `euclinicaltrials.eu/ctis-public-api/search` | არ სჭირდება | ევროკავშირის კლინიკური კვლევები |
| **WHO ICTRP** | — | — | Placeholder (არ აქვს სტაბილური API) |

---

## 4. ინფრასტრუქტურის კომპონენტები

### 4.1. Vercel — სტატიკური საიტი + Serverless

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **ტიპი** | Static site + Serverless Functions |
| **დომენი** | `medgzuri.ge`, `www.medgzuri.ge` |
| **Serverless Functions** | `api/search.js` (120s), `api/auth.js` (30s), `api/leads.js` (30s), `api/qa.js` (120s) |
| **Framework** | არცერთი (vanilla HTML/CSS/JS) |
| **Node.js** | >= 18.0.0 |

**გვერდები:**
| Route | ფაილი | აღწერა |
|-------|-------|--------|
| `/` | `index.html` | Landing გვერდი (horizontal scroll) |
| `/product` | `product.html` | ძიების ინტერფეისი (3 ტაბი) |
| `/login` | `login.html` | ავტორიზაციის UI |
| `/admin` | `admin.html` | ადმინის დაშბორდი |
| `/crm` | `crm.html` | CRM სისტემა |
| `/qa` | `qa.html` | ხარისხის აუდიტის დაშბორდი |

---

### 4.2. Railway — FastAPI Backend

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **Framework** | FastAPI 0.115.6 |
| **Runtime** | Python + Uvicorn 0.34.0 |
| **URL** | `medgzuri-production.up.railway.app` |
| **Builder** | Nixpacks |
| **Deployment** | `uvicorn app.main:app --host 0.0.0.0 --port ${PORT}` |

---

### 4.3. Supabase — მონაცემთა ბაზა & ავტორიზაცია

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **ტიპი** | PostgreSQL (hosted) |
| **SDK** | `@supabase/supabase-js ^2.49.1` |
| **Auth** | Supabase Auth (email + password) |
| **RLS** | Row Level Security ჩართულია ყველა ტაბულაზე |

**ტაბულები:**
| ტაბულა | აღწერა |
|--------|--------|
| `search_logs` | ძიების ტელემეტრია |
| `leads` | საკონტაქტო ფორმის მონაცემები |
| `saved_searches` | მომხმარებლის შენახული ძიებები |
| `profiles` | მომხმარებლის პროფილები (user/admin/operator) |
| `site_config` | საიტის კონფიგურაცია |

---

### 4.4. n8n — Workflow Automation

| Workflow | აგენტების რაოდენობა | AI მოდელები |
|----------|--------------------|-----------|
| **Research** | 4 (3 Perplexity + 1 Claude) | `sonar` × 3, `claude-sonnet-4-5-20250514` × 1 |
| **Clinics** | 4 (3 Perplexity + 1 Claude) | `sonar` × 3, `claude-sonnet-4-5-20250514` × 1 |
| **Symptoms** | 4 (2 Perplexity + 2 Claude) | `sonar` × 2, `claude-sonnet-4-5-20250514` × 2 |

**უსაფრთხოება:** Webhook secret ვალიდაცია (`N8N_WEBHOOK_SECRET`)

---

### 4.5. Redis — ქეშირება (Backend v2)

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **ვერსია** | Redis 7 Alpine |
| **TTL — კლინიკური კვლევები** | 24 საათი |
| **TTL — PubMed** | 7 დღე |
| **TTL — კლინიკები** | 30 დღე |

---

### 4.6. PostgreSQL — Backend v2 მონაცემთა ბაზა

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **ვერსია** | PostgreSQL 16 Alpine |
| **Driver** | asyncpg (ასინქრონული) |

---

### 4.7. Next.js Frontend (v2)

| პარამეტრი | მნიშვნელობა |
|----------|------------|
| **Next.js** | 16.1.6 |
| **React** | 19.2.3 |
| **TypeScript** | 5.x |
| **Tailwind CSS** | 4.x |
| **API URL** | `medgzuri-production.up.railway.app` |

---

## 5. API Pipeline-ის ნაკადი

### 5.1. Vercel Serverless Pipeline (api/search.js)

```
მოთხოვნა → CORS → Rate Limit → ვალიდაცია → ქეში
    │                                           │
    │  ქეშის hit ──────────────────────────────►│──► პასუხი
    │                                            │
    │  ქეშის miss ──► n8n Workflow ──────────────┤
    │                     │ წარუმატებელი         │
    │                     ▼                      │
    │              Railway FastAPI ───────────────┤
    │              (აგენტ-ორკესტრატორი)           │
    │                     │ წარუმატებელი         │
    │                     ▼                      │
    │              Perplexity API (sonar)         │
    │                     │                      │
    │                     ▼                      │
    │              Claude (sonnet-4.5) ──────────►│──► პასუხი + ქეში
    │                     │ წარუმატებელი         │
    │                     ▼                      │
    │              Raw Perplexity results ───────►│──► პასუხი
    │                     │ წარუმატებელი         │
    │                     ▼                      │
    │              Demo მონაცემები ──────────────►│──► პასუხი
```

> **შენიშვნა:** Railway proxy ჩართულია `RAILWAY_BACKEND_URL` env variable-ით.
> n8n და Railway proxy-ს შორის, n8n-ს აქვს პრიორიტეტი.
> Report ტიპი (`type: 'report'`) მხოლოდ ლოკალურად მუშავდება (Perplexity + Claude).

### 5.2. FastAPI Backend Pipeline (v2)

**Research Pipeline:** A1 → (A2 ‖ A3) → A4 → A5
| ეტაპი | აგენტი | AI |
|-------|--------|-----|
| A1 | ტერმინების ნორმალიზატორი | Claude Sonnet |
| A2 | კლინიკური კვლევების ძიება | — (PubMed, ClinicalTrials.gov) |
| A3 | ლიტერატურის ძიება + შეჯამება | Claude Sonnet |
| A4 | აგრეგატორი / სკორინგი | Claude Sonnet |
| A5 | ანგარიშის გენერატორი | Claude Opus (fallback: Sonnet) |

**Symptoms Pipeline:** B1 → B2 → B3 → B4
| ეტაპი | აგენტი | AI |
|-------|--------|-----|
| B1 | სიმპტომების პარსერი | Claude Sonnet |
| B2 | დიფერენციალური ანალიზი | Claude Sonnet |
| B3 | კვლევების მატჩერი | Claude Sonnet (pipeline A-ს გამოყენებით) |
| B4 | ნავიგატორის ანგარიში | Claude Opus (fallback: Sonnet) |

**Clinics Pipeline:** C1 → C2 → (C3 ‖ C4) → C5
| ეტაპი | აგენტი | AI |
|-------|--------|-----|
| C1 | Query Builder | Claude Sonnet |
| C2 | კლინიკების მძებნელი | — (ClinicalTrials.gov) |
| C3 | რეიტინგის აგენტი | — (PubMed API) |
| C4 | ფასების აგენტი | — (hardcoded მონაცემები) |
| C5 | კლინიკების ანგარიში | Claude Opus (fallback: Sonnet) |

---

## 6. Environment Variables — სრული სია

| ცვლადი | სად გამოიყენება | აუცილებელი? |
|--------|----------------|------------|
| `PERPLEXITY_API_KEY` | Vercel API, n8n | კი (ძიებისთვის) |
| `ANTHROPIC_API_KEY` | Vercel API, n8n, Backend | კი (ანალიზისთვის) |
| `OPENAI_API_KEY` | Vercel API | არა (Phase 2) |
| `N8N_WEBHOOK_BASE_URL` | Vercel API | არა (optional) |
| `N8N_WEBHOOK_SECRET` | Vercel API, n8n | კი (თუ n8n აქტიურია) |
| `RAILWAY_BACKEND_URL` | Vercel API | არა (Railway FastAPI proxy) |
| `SUPABASE_URL` | Vercel API (auth, leads, logs) | კი (DB-სთვის) |
| `SUPABASE_SERVICE_KEY` | Vercel API | კი (DB-სთვის) |
| `SUPABASE_ANON_KEY` | Frontend auth | კი (ავტორიზაციისთვის) |
| `ALLOWED_ORIGINS` | ყველა API | არა (default: *) |
| `NCBI_API_KEY` | Backend | არა (rate limit-ს ზრდის) |
| `DATABASE_URL` | Backend | კი (Backend-ისთვის) |
| `REDIS_URL` | Backend | კი (ქეშისთვის) |
| `DEEPL_API_KEY` | Backend | არა (Phase 2) |
| `NEXT_PUBLIC_API_URL` | Next.js Frontend | არა (default: railway) |

---

## 7. უსაფრთხოების ზომები

| ზომა | კომპონენტი | აღწერა |
|------|-----------|--------|
| **Rate Limiting** | ყველა API | IP-ზე დაფუძნებული (20 req/min search, 5 req/min auth, 10 req/min leads) |
| **CORS** | ყველა API | Origin whitelist (medgzuri.ge, localhost) |
| **Input Validation** | ყველა API | ტექსტის სიგრძე ≤ 2000, ასაკი 0-150, control chars strip |
| **XSS Prevention** | Frontend | `escapeHtml()` ფუნქცია |
| **Security Headers** | lib/security.js | X-Content-Type-Options, X-Frame-Options, CSP |
| **RLS** | Supabase | Row Level Security ყველა ტაბულაზე |
| **Password Policy** | lib/security.js | ≥8 სიმბოლო, 1 დიდი, 1 პატარა, 1 ციფრი |
| **Webhook Secret** | n8n | Secret header ვალიდაცია |
| **Compliance Guard** | Backend | დიაგნოზის განცხადებების ბლოკირება, disclaimer ვალიდაცია |
| **LRU Cache** | Vercel API | 100 entry, 30 წუთი TTL, periodic sweep |

---

## 8. სამედიცინო უსაფრთხოება

- **არასოდეს აკეთებს დიაგნოზს** — მხოლოდ რეკომენდაციები
- **Compliance Guard** (backend) — ამოწმებს პასუხებს აკრძალული ფრაზებისთვის
- **Disclaimer** — ყველა პასუხს აქვს "ეს არ ჩაანაცვლებს ექიმის კონსულტაციას"
- **DIAGNOSIS_PATTERNS** (qa.js) — პატერნების დეტექცია დიაგნოზის განცხადებებისთვის

---

## 9. შეჯამება — AI მოდელების რუკა

```
┌────────────────────────────────────────────────────────┐
│              MED&გზური — AI ეკოსისტემა                  │
│                                                        │
│  ┌─────────────────────────────────────────────┐       │
│  │         Anthropic Claude (ძირითადი)          │       │
│  │                                             │       │
│  │  Sonnet 4.5 (claude-sonnet-4-5-20250514)   │       │
│  │  → Vercel API, n8n workflows               │       │
│  │                                             │       │
│  │  Sonnet 4.6 (claude-sonnet-4-6)            │       │
│  │  → FastAPI backend (მსუბუქი ამოცანები)      │       │
│  │                                             │       │
│  │  Opus 4.6 (claude-opus-4-6)                │       │
│  │  → FastAPI backend (რთული ანგარიშები)       │       │
│  └─────────────────────────────────────────────┘       │
│                                                        │
│  ┌─────────────────────────────────────────────┐       │
│  │         Perplexity AI (ძიება)                │       │
│  │                                             │       │
│  │  Sonar (sonar)                              │       │
│  │  → ვებ-ძიება სამედიცინო ინფორმაციის        │       │
│  │  → 8 პარალელური აგენტი n8n-ში              │       │
│  └─────────────────────────────────────────────┘       │
│                                                        │
│  ┌─────────────────────────────────────────────┐       │
│  │         OpenAI GPT (Phase 2 — არააქტიური)   │       │
│  │  → ფაქტების ვერიფიკაცია                    │       │
│  └─────────────────────────────────────────────┘       │
│                                                        │
│  ┌─────────────────────────────────────────────┐       │
│  │         DeepL (Phase 2 — არააქტიური)        │       │
│  │  → სარეზერვო თარგმანი                       │       │
│  └─────────────────────────────────────────────┘       │
│                                                        │
│  ┌─────────────────────────────────────────────┐       │
│  │         Chatbot (წესებზე დაფუძნებული)        │       │
│  │  → AI არ იყენებს, keyword matching          │       │
│  └─────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────┘
```
