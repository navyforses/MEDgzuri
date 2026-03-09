"""MedGzuri Backend — FastAPI application entry point.

Provides:
  - /api/search     — v1 search endpoint (existing)
  - /api/v2/search  — v2 multi-agent search
  - /api/chat       — chatbot endpoint
  - /api/chat/{id}/history — chat history
  - /api/profile    — user profile (GET, PUT)
  - /api/history    — search history (GET)
  - /api/bookmarks  — bookmarks (GET, POST, DELETE)
  - /api/alerts     — alerts (GET, POST, DELETE)
  - /api/doctor/register  — doctor registration (POST)
  - /api/doctor/share     — share result with patient (POST, GET)
  - /api/doctor/referral  — create referral (POST)
"""

import asyncio
import hashlib
import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.orchestrator.router import OrchestratorRouter
from app.orchestrator.schemas import SearchRequest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("medgzuri")


# ═══════════════ RATE LIMITER ═══════════════

class RateLimiter:
    """Fixed-window rate limiter by IP."""

    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_limited(self, ip: str) -> bool:
        now = time.monotonic()
        window_start = now - self.window
        hits = self._hits[ip]
        # Remove expired entries
        self._hits[ip] = [t for t in hits if t > window_start]
        if len(self._hits[ip]) >= self.max_requests:
            return True
        self._hits[ip].append(now)
        return False


rate_limiter = RateLimiter(settings.rate_limit_per_minute)
orchestrator = OrchestratorRouter()


# ═══════════════ LIFESPAN ═══════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("MedGzuri backend starting | demo_mode=%s", settings.is_demo_mode)

    # Initialize database (graceful degradation if unavailable)
    from app.database import close_db, init_db
    db_ok = await init_db()
    logger.info("Database: %s", "connected" if db_ok else "unavailable (continuing without)")

    # Initialize Redis cache (graceful degradation if unavailable)
    from app.services.cache import cache_service
    redis_ok = await cache_service.connect()
    logger.info("Redis: %s", "connected" if redis_ok else "unavailable (using in-memory fallback)")

    # Initialize RAG knowledge base
    from app.services.medical_rag import build_knowledge_base
    rag_count = build_knowledge_base()
    logger.info("RAG knowledge base: %d conditions loaded", rag_count)

    yield

    await cache_service.disconnect()
    await close_db()
    logger.info("MedGzuri backend shutting down")


# ═══════════════ APP ═══════════════

app = FastAPI(
    title="MedGzuri API",
    description="Georgian medical research navigation API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ═══════════════ ENDPOINTS ═══════════════

@app.get("/health")
async def health():
    # OpenAlex ხელმისაწვდომობის შემოწმება (არასავალდებულო)
    openalex_ok = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("https://api.openalex.org/works?per_page=1")
            openalex_ok = resp.status_code == 200
    except Exception:
        pass

    return {
        "status": "ok",
        "demo_mode": settings.is_demo_mode,
        "has_anthropic": settings.has_anthropic_key,
        "openalex": "ok" if openalex_ok else "unavailable",
    }


async def _log_search_history(
    pipeline_type: str,
    input_data: dict,
    response_data: dict,
    execution_time_ms: int,
    client_ip_hash: str,
    source: str = "direct",
):
    """Fire-and-forget background task to log search history to DB."""
    try:
        from app.database import async_session_factory
        from app.models.search_history import SearchHistory

        async with async_session_factory() as session:
            record = SearchHistory(
                pipeline_type=pipeline_type,
                input_data=input_data,
                response_data=response_data,
                execution_time_ms=execution_time_ms,
                client_ip_hash=client_ip_hash,
                source=source,
            )
            session.add(record)
            await session.commit()
    except Exception as e:
        logger.debug("Search history logging skipped: %s", str(e)[:100])


@app.post("/api/search")
async def search(request: Request, background_tasks: BackgroundTasks):
    """Main search endpoint — compatible with existing frontend."""
    client_ip = _get_client_ip(request)
    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()

    if rate_limiter.is_limited(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი."},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "არასწორი მოთხოვნის ფორმატი."},
        )

    search_req = SearchRequest(**body)
    pipeline_type = search_req.get_pipeline_type()

    # Execute pipeline via orchestrator (with safety-net timeout)
    start = time.monotonic()
    try:
        result = await asyncio.wait_for(
            orchestrator.route(search_req),
            timeout=settings.pipeline_timeout_seconds + 30,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.info(
            "Search completed | type=%s | items=%d | %dms | ip=%s",
            pipeline_type, len(result.items), elapsed_ms, client_ip,
        )
        response_data = result.model_dump(exclude_none=True)
        response_data["_pipeline"] = {"ms": elapsed_ms, "source": "agent-orchestra"}

        # Log to DB in background (fire-and-forget)
        background_tasks.add_task(
            _log_search_history,
            pipeline_type=pipeline_type,
            input_data=body,
            response_data=response_data,
            execution_time_ms=elapsed_ms,
            client_ip_hash=ip_hash,
        )

        return JSONResponse(content=response_data)

    except asyncio.TimeoutError:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("Search timed out | %dms | type=%s", elapsed_ms, pipeline_type)
        return JSONResponse(
            status_code=504,
            content={"error": "მოთხოვნის დამუშავებას ძალიან დიდი დრო დასჭირდა. გთხოვთ სცადოთ თავიდან."},
        )
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("Search failed | %dms | %s", elapsed_ms, str(e)[:300])
        return JSONResponse(
            status_code=500,
            content={"error": "ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით."},
        )


# ═══════════════ V2: MULTI-AGENT SEARCH ═══════════════

@app.post("/api/v2/search")
async def search_v2(request: Request, background_tasks: BackgroundTasks):
    """V2 search endpoint — uses multi-agent orchestrator."""
    client_ip = _get_client_ip(request)
    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()

    if rate_limiter.is_limited(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი."},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "არასწორი მოთხოვნის ფორმატი."},
        )

    query = body.get("query", body.get("diagnosis", body.get("symptoms", "")))
    query_type = body.get("query_type")
    profile_data = body.get("profile")

    if not query:
        return JSONResponse(
            status_code=400,
            content={"error": "გთხოვთ მიუთითოთ საძიებო მოთხოვნა."},
        )

    from app.agents.orchestrator import OrchestratorAgent
    from app.services.personalization import PatientProfile

    profile = None
    if profile_data and isinstance(profile_data, dict):
        try:
            profile = PatientProfile(**profile_data)
        except Exception:
            pass  # Invalid profile data — proceed without personalization

    agent_orchestrator = OrchestratorAgent()
    start = time.monotonic()

    try:
        result = await asyncio.wait_for(
            agent_orchestrator.process_query(query, query_type, profile),
            timeout=settings.pipeline_timeout_seconds + 30,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        response_data = result.search_response.model_dump(exclude_none=True)
        response_data["_pipeline"] = {
            "ms": elapsed_ms,
            "source": "multi-agent-v2",
            "performance": result.performance.model_dump(),
            "agent_errors": result.agent_errors,
        }

        logger.info(
            "V2 search completed | items=%d | %dms | ip=%s",
            len(result.search_response.items), elapsed_ms, client_ip,
        )

        # Log to DB in background
        background_tasks.add_task(
            _log_search_history,
            pipeline_type="v2_multi_agent",
            input_data=body,
            response_data=response_data,
            execution_time_ms=elapsed_ms,
            client_ip_hash=ip_hash,
            source="multi-agent-v2",
        )

        return JSONResponse(content=response_data)

    except asyncio.TimeoutError:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("V2 search timed out | %dms", elapsed_ms)
        return JSONResponse(
            status_code=504,
            content={"error": "მოთხოვნის დამუშავებას ძალიან დიდი დრო დასჭირდა."},
        )
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("V2 search failed | %dms | %s", elapsed_ms, str(e)[:300])
        return JSONResponse(
            status_code=500,
            content={"error": "ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით."},
        )


# ═══════════════ CHATBOT ═══════════════

@app.post("/api/chat")
async def chat_endpoint(request: Request):
    """Chatbot endpoint — start session or send message."""
    client_ip = _get_client_ip(request)
    if rate_limiter.is_limited(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი."},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "არასწორი მოთხოვნის ფორმატი."},
        )

    from app.services.chatbot import chat, start_session

    action = body.get("action", "message")

    if action == "start":
        # Start a new chat session
        search_context = body.get("search_context")
        session_id = start_session(search_context)
        return JSONResponse(content={
            "session_id": session_id,
            "message": "საუბარი დაწყებულია! როგორ შემიძლია დაგეხმაროთ?",
        })

    # Send a message
    session_id = body.get("session_id", "")
    message = body.get("message", "")

    if not session_id:
        return JSONResponse(
            status_code=400,
            content={"error": "სესიის ID აუცილებელია. დაიწყეთ ახალი საუბარი action='start'-ით."},
        )

    if not message:
        return JSONResponse(
            status_code=400,
            content={"error": "შეტყობინება ცარიელია."},
        )

    try:
        response = await asyncio.wait_for(
            chat(session_id, message),
            timeout=60,
        )
        return JSONResponse(content={
            "session_id": session_id,
            "response": response,
        })
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=504,
            content={"error": "პასუხის გენერაციას ძალიან დიდი დრო დასჭირდა."},
        )
    except Exception as e:
        logger.error("Chat failed: %s", str(e)[:200])
        return JSONResponse(
            status_code=500,
            content={"error": "ჩატბოტის შეცდომა. გთხოვთ სცადოთ თავიდან."},
        )


@app.get("/api/chat/{session_id}/history")
async def chat_history(session_id: str):
    """Get chat history for a session."""
    from app.services.chatbot import get_history

    history = get_history(session_id)
    if not history:
        return JSONResponse(
            status_code=404,
            content={"error": "სესია ვერ მოიძებნა ან ისტორია ცარიელია."},
        )

    return JSONResponse(content={
        "session_id": session_id,
        "messages": history,
    })


# ═══════════════ PHASE 5: DEPENDENCIES & PLATFORM FEATURES ═══════════════


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request headers."""
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not client_ip:
        client_ip = request.client.host if request.client else "unknown"
    return client_ip


async def require_rate_limit(request: Request) -> str:
    """FastAPI dependency: extract client IP and enforce rate limit."""
    client_ip = _get_client_ip(request)
    if rate_limiter.is_limited(client_ip):
        raise HTTPException(
            status_code=429,
            detail="ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.",
        )
    return client_ip


async def require_auth(request: Request) -> str:
    """FastAPI dependency: rate limit + JWT auth. Returns user_id."""
    await require_rate_limit(request)
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="ავტორიზაცია აუცილებელია.")
    token = auth_header[7:]
    try:
        import jwt
        if settings.supabase_jwt_secret:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            logger.warning("SUPABASE_JWT_SECRET not set — JWT signature verification disabled")
            payload = jwt.decode(token, options={"verify_signature": False})
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="ავტორიზაცია აუცილებელია.")
        return user_id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="არასწორი ან ვადაგასული ტოკენი.")


async def parse_json_body(request: Request) -> dict:
    """FastAPI dependency: parse JSON request body."""
    try:
        return await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="არასწორი მოთხოვნის ფორმატი.")


@app.get("/api/profile")
async def get_profile(user_id: str = Depends(require_auth)):
    """Get user profile."""
    try:
        from app.services.platform import get_user_profile
        profile = await get_user_profile(user_id)
        return JSONResponse(content=profile)
    except Exception as e:
        logger.error("Get profile failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "პროფილის ჩატვირთვა ვერ მოხერხდა."})


@app.put("/api/profile")
async def update_profile(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Update user profile."""
    try:
        from app.services.platform import update_user_profile
        profile = await update_user_profile(user_id, body)
        return JSONResponse(content=profile)
    except Exception as e:
        logger.error("Update profile failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "პროფილის განახლება ვერ მოხერხდა."})


@app.get("/api/history")
async def get_history_endpoint(user_id: str = Depends(require_auth)):
    """Get search history for the authenticated user."""
    try:
        from app.services.platform import get_search_history as fetch_history
        history = await fetch_history(user_id)
        return JSONResponse(content={"items": history})
    except Exception as e:
        logger.error("Get history failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "ისტორიის ჩატვირთვა ვერ მოხერხდა."})


@app.post("/api/bookmarks")
async def add_bookmark_endpoint(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Add a bookmark."""
    try:
        from app.services.platform import add_bookmark as svc_add_bookmark
        bookmark = await svc_add_bookmark(user_id, body)
        return JSONResponse(status_code=201, content=bookmark)
    except Exception as e:
        logger.error("Add bookmark failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "სანიშნეს დამატება ვერ მოხერხდა."})


@app.get("/api/bookmarks")
async def get_bookmarks_endpoint(user_id: str = Depends(require_auth)):
    """Get all bookmarks for the authenticated user."""
    try:
        from app.services.platform import get_bookmarks as svc_get_bookmarks
        bookmarks = await svc_get_bookmarks(user_id)
        return JSONResponse(content={"items": bookmarks})
    except Exception as e:
        logger.error("Get bookmarks failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "სანიშნეების ჩატვირთვა ვერ მოხერხდა."})


@app.delete("/api/bookmarks/{bookmark_id}")
async def delete_bookmark_endpoint(bookmark_id: str, user_id: str = Depends(require_auth)):
    """Delete a bookmark."""
    try:
        from app.services.platform import delete_bookmark as svc_delete_bookmark
        await svc_delete_bookmark(user_id, bookmark_id)
        return JSONResponse(content={"status": "წაშლილია"})
    except Exception as e:
        logger.error("Delete bookmark failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "სანიშნეს წაშლა ვერ მოხერხდა."})


@app.post("/api/alerts")
async def create_alert_endpoint(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Create a search alert."""
    try:
        from app.services.platform import create_alert as svc_create_alert
        alert = await svc_create_alert(user_id, body)
        return JSONResponse(status_code=201, content=alert)
    except Exception as e:
        logger.error("Create alert failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "შეტყობინების შექმნა ვერ მოხერხდა."})


@app.get("/api/alerts")
async def get_alerts_endpoint(user_id: str = Depends(require_auth)):
    """Get all alerts for the authenticated user."""
    try:
        from app.services.platform import get_alerts as svc_get_alerts
        alerts = await svc_get_alerts(user_id)
        return JSONResponse(content={"items": alerts})
    except Exception as e:
        logger.error("Get alerts failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "შეტყობინებების ჩატვირთვა ვერ მოხერხდა."})


@app.delete("/api/alerts/{alert_id}")
async def delete_alert_endpoint(alert_id: str, user_id: str = Depends(require_auth)):
    """Delete an alert."""
    try:
        from app.services.platform import delete_alert as svc_delete_alert
        await svc_delete_alert(user_id, alert_id)
        return JSONResponse(content={"status": "წაშლილია"})
    except Exception as e:
        logger.error("Delete alert failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "შეტყობინების წაშლა ვერ მოხერხდა."})


@app.post("/api/doctor/register")
async def doctor_register(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Register a user as a doctor."""
    try:
        from app.services.platform import register_doctor
        result = await register_doctor(user_id, body)
        return JSONResponse(status_code=201, content=result)
    except Exception as e:
        logger.error("Doctor register failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "ექიმის რეგისტრაცია ვერ მოხერხდა."})


@app.post("/api/doctor/share")
async def doctor_share(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Share a search result with a patient."""
    try:
        from app.services.platform import share_result
        result = await share_result(user_id, body)
        return JSONResponse(status_code=201, content=result)
    except Exception as e:
        logger.error("Doctor share failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "შედეგის გაზიარება ვერ მოხერხდა."})


@app.get("/api/doctor/share/{share_token}")
async def get_shared_result_endpoint(share_token: str, _ip: str = Depends(require_rate_limit)):
    """Get a shared result by token (no auth required)."""
    try:
        from app.services.platform import get_shared_result as svc_get_shared
        result = await svc_get_shared(share_token)
        if not result:
            return JSONResponse(status_code=404, content={"error": "გაზიარებული შედეგი ვერ მოიძებნა."})
        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Get shared result failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "გაზიარებული შედეგის ჩატვირთვა ვერ მოხერხდა."})


@app.post("/api/doctor/referral")
async def create_referral_endpoint(user_id: str = Depends(require_auth), body: dict = Depends(parse_json_body)):
    """Create a doctor referral."""
    try:
        from app.services.platform import create_referral as svc_create_referral
        result = await svc_create_referral(user_id, body)
        return JSONResponse(status_code=201, content=result)
    except Exception as e:
        logger.error("Create referral failed: %s", str(e)[:200])
        return JSONResponse(status_code=500, content={"error": "რეფერალის შექმნა ვერ მოხერხდა."})
