"""MedGzuri Backend — FastAPI application entry point.

Provides /api/search endpoint compatible with the existing frontend.
"""

import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
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
    yield
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


@app.post("/api/search")
async def search(request: Request):
    """Main search endpoint — compatible with existing frontend."""
    # Rate limiting
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not client_ip:
        client_ip = request.client.host if request.client else "unknown"

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

    # Execute pipeline via orchestrator
    start = time.monotonic()
    try:
        result = await orchestrator.route(search_req)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.info(
            "Search completed | type=%s | items=%d | %dms | ip=%s",
            search_req.get_pipeline_type(), len(result.items), elapsed_ms, client_ip,
        )
        response_data = result.model_dump(exclude_none=True)
        response_data["_pipeline"] = {"ms": elapsed_ms, "source": "agent-orchestra"}
        return JSONResponse(content=response_data)

    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error("Search failed | %dms | %s", elapsed_ms, str(e)[:300])
        return JSONResponse(
            status_code=500,
            content={"error": "ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით."},
        )
