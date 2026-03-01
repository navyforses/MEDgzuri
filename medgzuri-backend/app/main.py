"""MedGzuri Backend — FastAPI application entry point.

Provides /api/search endpoint compatible with the existing frontend.
"""

import hashlib
import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, Request
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
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["Content-Type"],
)


# ═══════════════ ENDPOINTS ═══════════════

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "demo_mode": settings.is_demo_mode,
        "has_anthropic": settings.has_anthropic_key,
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
    # Rate limiting
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not client_ip:
        client_ip = request.client.host if request.client else "unknown"

    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()

    if rate_limiter.is_limited(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი."},
        )

    # Parse request
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "არასწორი მოთხოვნის ფორმატი."},
        )

    search_req = SearchRequest(**body)
    pipeline_type = search_req.get_pipeline_type()

    # Execute pipeline via orchestrator
    start = time.monotonic()
    try:
        result = await orchestrator.route(search_req)
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

    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("Search failed | %dms | %s", elapsed_ms, str(e)[:300])
        return JSONResponse(
            status_code=500,
            content={"error": "ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით."},
        )
