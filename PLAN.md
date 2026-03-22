# მედგზური — დარჩენილი კომპონენტების იმპლემენტაციის გეგმა

## მიმოხილვა

სისტემის ~90% აშენებულია. დარჩენილია 5 კომპონენტი — ინფრასტრუქტურული სერვისები,
რომლებიც სისტემას პროდაქშენ-მზად გახდიან. მათ გარეშე სისტემა მუშაობს, მაგრამ
არ ინახავს ისტორიას, არ აქეშირებს Redis-ით და არ ადევნებს წყაროებს თვალს.

**რა არის აშენებული:**
- 3 Pipeline სრულად (Research A1-A5, Symptoms B1-B4, Clinics C1-C5)
- 5 გარე API ინტეგრაცია (ClinicalTrials.gov, PubMed, Europe PMC, EU CTR, WHO ICTRP)
- Orchestrator Router (request dispatch)
- LLM Client (Sonnet + Opus, retry logic)
- Compliance Guard (disclaimer, diagnosis/prescription prevention)
- 20+ Pydantic Schemas
- 8+ Prompt Templates
- Docker Compose (PostgreSQL 16, Redis 7, FastAPI)
- 10+ Test files

**რა აკლია:**
1. Dependencies (SQLAlchemy, asyncpg, redis-py არ არის requirements.txt-ში)
2. Database Layer (models ცარიელია, PostgreSQL არ გამოიყენება)
3. Redis Cache Service (Redis Docker-ში ეშვება, მაგრამ Python client არ არის)
4. Source Tracker Service (არ არსებობს)
5. Translation Service (მხოლოდ static dictionary არის)

---

## ეტაპი 1: Dependencies — `requirements.txt` განახლება

**ფაილი:** `medgzuri-backend/requirements.txt`

დასამატებელი ბიბლიოთეკები:
```
sqlalchemy[asyncio]==2.0.36
asyncpg==0.30.0
alembic==1.14.1
redis==5.2.1
```

**მიზეზი:** Docker-ში PostgreSQL და Redis უკვე ეშვება, მაგრამ Python-ში client
ბიბლიოთეკები არ არის. ეს აუცილებელი წინაპირობაა ყველა შემდგომი ეტაპისთვის.

---

## ეტაპი 2: Database Layer

### 2.1 — Database Engine & Session

**ახალი ფაილი:** `app/database.py`

- `AsyncEngine` შექმნა `settings.database_url`-ით (asyncpg driver)
- `async_sessionmaker` — async session factory
- `get_db()` — FastAPI dependency injection-ისთვის
- `init_db()` — ცხრილების შექმნა startup-ზე
- `close_db()` — engine dispose shutdown-ზე

### 2.2 — SQLAlchemy Models

**ფაილი `app/models/search_history.py`:**

`SearchHistory` ცხრილი:
| სვეტი | ტიპი | აღწერა |
|-------|------|--------|
| id | UUID (PK) | უნიკალური იდენტიფიკატორი |
| pipeline_type | String | research_search / symptom_navigation / clinic_search |
| input_data | JSONB | მომხმარებლის მოთხოვნის სრული JSON |
| response_data | JSONB | სრული პასუხის JSON |
| source | String | direct / n8n / railway / cache |
| execution_time_ms | Integer | შესრულების დრო მილიწამებში |
| client_ip_hash | String | IP-ის SHA-256 hash (privacy) |
| created_at | DateTime (UTC) | ჩანაწერის თარიღი |

**ფაილი `app/models/cached_results.py`:**

`CachedResult` ცხრილი:
| სვეტი | ტიპი | აღწერა |
|-------|------|--------|
| id | UUID (PK) | უნიკალური იდენტიფიკატორი |
| cache_key | String (unique, indexed) | normalized query + filters hash |
| pipeline_type | String | pipeline-ის ტიპი |
| result_data | JSONB | დაქეშირებული შედეგი |
| expires_at | DateTime | ვადის გასვლის თარიღი |
| created_at | DateTime | შექმნის თარიღი |
| hit_count | Integer (default 0) | რამდენჯერ გამოიყენეს ქეშიდან |

**ფაილი `app/models/__init__.py`:** Base, SearchHistory, CachedResult ექსპორტი

### 2.3 — Alembic Migrations

- `alembic init` ინიციალიზაცია async კონფიგურაციით
- `env.py` — asyncpg driver-თან თავსებადი
- საწყისი მიგრაცია: ორივე ცხრილის შექმნა

### 2.4 — FastAPI ინტეგრაცია

`app/main.py`-ში ცვლილებები:
- `lifespan` context manager-ში `init_db()` / `close_db()` დამატება
- `/api/search` endpoint-ში — ისტორიის ჩაწერა background task-ით (fire-and-forget, არ ანელებს response-ს)

---

## ეტაპი 3: Redis Cache Service

### 3.1 — Redis Client

**ახალი ფაილი:** `app/services/cache.py`

- Singleton async Redis connection (`redis.asyncio.Redis`)
- `connect()` / `disconnect()` — lifecycle management
- Fallback: თუ Redis მიუწვდომელია → `cachetools.TTLCache` (in-memory)

### 3.2 — Cache Service API

```
get(key: str) -> dict | None          — ქეშიდან წაკითხვა
set(key: str, data: dict, ttl: int)   — ქეშში ჩაწერა TTL-ით
make_key(pipeline_type, input_data)    — cache key გენერაცია (SHA-256)
invalidate(pattern: str)               — pattern-based invalidation
```

TTL (უკვე config.py-ში დეფინირებულია):
- Clinical Trials: 86400 წამი (24 საათი)
- PubMed: 604800 წამი (7 დღე)
- კლინიკები: 2592000 წამი (30 დღე)

### 3.3 — Orchestrator ინტეგრაცია

`orchestrator/router.py`-ში:
1. Pipeline-მდე → cache check (hit = პირდაპირ return)
2. Pipeline-ის შემდეგ → cache write
3. Response-ში `_pipeline.source = "cache"` თუ ქეშიდანაა

---

## ეტაპი 4: Source Tracker Service

### 4.1 — Source Tracker

**ახალი ფაილი:** `app/services/source_tracker.py`

- `SourceEntry` — Pydantic model: fact, source_url, source_type, agent_id
- `SourceTracker` class (per-request instance):
  - `track(fact, source_url, source_type)` — ფაქტი + წყაროს რეგისტრაცია
  - `get_all() -> list[SourceEntry]` — ყველა დაგროვილი წყარო
  - `attach_to_response(response)` — response-ში წყაროების ჩამატება
  - `deduplicate()` — დუბლიკატი URL-ების მოხსნა

### 4.2 — Pipeline ინტეგრაცია

- `SourceTracker` ინსტანსი იქმნება orchestrator-ში და გადაეცემა pipeline-ს
- ყველა data-fetching აგენტი (A2, A3, C2, C3) ავსებს tracker-ს
- ანგარიშის გენერატორი (A5, B4, C5) იღებს წყაროების სიას

---

## ეტაპი 5: Translation Service

### 5.1 — Unified Translation Service

**ახალი ფაილი:** `app/services/translation.py`

```
class TranslationService:
    translate(text, source_lang, target_lang) -> str
    translate_medical_term(term_ka) -> str
    batch_translate(terms: list[str]) -> list[str]
```

Fallback chain:
1. **Static Dictionary** — `medical_terms.py`-ს `KA_TO_EN` (მყისიერი, უფასო)
2. **Claude Sonnet** — LLM-based თარგმანი სამედიცინო კონტექსტით
3. **DeepL API** — backup (თუ `DEEPL_API_KEY` კონფიგურირებულია)

### 5.2 — ინტეგრაცია

- A1 (Term Normalizer) და B1 (Symptom Parser) უკვე Claude-ით თარგმნიან — ისინი შეიძლება TranslationService-ს გამოიყენებენ dictionary lookup-ისთვის LLM-მდე (ხარჯის დაზოგვა)
- ანგარიშის გენერატორებში ტექნიკური ტერმინების თარგმანისთვის

---

## ეტაპი 6: ტესტები და ვერიფიკაცია

### 6.1 — ახალი ტესტები

- `tests/test_database.py` — model CRUD, connection, session
- `tests/test_cache.py` — Redis set/get, TTL expiry, in-memory fallback
- `tests/test_source_tracker.py` — track, deduplicate, attach
- `tests/test_translation.py` — dictionary hit, LLM fallback

### 6.2 — არსებული ტესტების განახლება

- `tests/test_orchestrator.py` — cache integration, history logging
- `tests/test_services.py` — ახალი services-ების coverage

### 6.3 — End-to-End ვერიფიკაცია

- `docker-compose up` — PostgreSQL, Redis, FastAPI ჯანსაღია
- `alembic upgrade head` — მიგრაციები გადის
- `POST /api/search` → response + DB record + cache entry

---

## იმპლემენტაციის თანმიმდევრობა

```
ეტაპი 1: requirements.txt (წინაპირობა)
    ↓
ეტაპი 2: Database Layer (database.py → models → alembic → main.py)
    ↓
ეტაპი 3: Redis Cache (cache.py → router.py ინტეგრაცია)
    ↓
ეტაპი 4: Source Tracker (source_tracker.py → pipeline ინტეგრაცია)
    ↓
ეტაპი 5: Translation Service (translation.py → pipeline ინტეგრაცია)
    ↓
ეტაპი 6: ტესტები და ვერიფიკაცია
```

---

## შენიშვნები

- **არსებული კოდი არ იცვლება დესტრუქციულად** — მხოლოდ ინტეგრაციის წერტილები ემატება
- **Graceful degradation** — Redis/PostgreSQL მიუწვდომლობისას სისტემა აგრძელებს მუშაობას
- **არანაირი breaking change** — ფრონტენდის API კონტრაქტი უცვლელია
- **ყველა ახალი სერვისი async** — შესაბამისობა არსებულ არქიტექტურასთან
- **Privacy** — client IP ინახება SHA-256 hash-ით, არა raw ტექსტით
