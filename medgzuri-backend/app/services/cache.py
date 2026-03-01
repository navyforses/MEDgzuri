"""S2 — Cache service with Redis backend and in-memory fallback.

TTL per pipeline type (from config):
  - Clinical Trials: 24h
  - PubMed: 7 days
  - Clinics: 30 days

Graceful degradation: if Redis is unavailable, uses cachetools.TTLCache in-memory.
"""

import hashlib
import json
import logging

from cachetools import TTLCache

from app.config import settings

logger = logging.getLogger(__name__)


class CacheService:
    """Async cache with Redis primary and in-memory fallback."""

    def __init__(self):
        self._redis = None
        self._fallback = TTLCache(maxsize=256, ttl=3600)  # 1h default
        self._available = False

    async def connect(self) -> bool:
        """Connect to Redis. Returns True on success."""
        try:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=3,
            )
            await self._redis.ping()
            self._available = True
            return True
        except Exception as e:
            logger.warning("Redis connection failed — using in-memory fallback: %s", str(e)[:100])
            self._redis = None
            self._available = False
            return False

    async def disconnect(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.aclose()
            self._redis = None
            self._available = False

    def make_key(self, pipeline_type: str, input_data: dict) -> str:
        """Generate a deterministic cache key from pipeline type and input."""
        normalized = json.dumps(input_data, sort_keys=True, ensure_ascii=False)
        content = f"{pipeline_type}:{normalized}"
        return f"mg:{hashlib.sha256(content.encode()).hexdigest()[:32]}"

    def get_ttl(self, pipeline_type: str) -> int:
        """Get TTL in seconds based on pipeline type."""
        ttl_map = {
            "research_search": settings.cache_ttl_pubmed,
            "symptom_navigation": settings.cache_ttl_clinical_trials,
            "clinic_search": settings.cache_ttl_clinics,
        }
        return ttl_map.get(pipeline_type, settings.cache_ttl_clinical_trials)

    async def get(self, key: str) -> dict | None:
        """Read from cache. Returns None on miss."""
        # Try Redis
        if self._available and self._redis:
            try:
                data = await self._redis.get(key)
                if data:
                    logger.info("Cache HIT (Redis) | key=%s", key[:20])
                    return json.loads(data)
            except Exception as e:
                logger.debug("Redis GET error: %s", str(e)[:100])

        # Try in-memory fallback
        data = self._fallback.get(key)
        if data:
            logger.info("Cache HIT (memory) | key=%s", key[:20])
            return data

        return None

    async def set(self, key: str, data: dict, ttl: int | None = None):
        """Write to cache with TTL."""
        ttl = ttl or 3600

        # Write to Redis
        if self._available and self._redis:
            try:
                await self._redis.setex(key, ttl, json.dumps(data, ensure_ascii=False))
                logger.info("Cache SET (Redis) | key=%s | ttl=%ds", key[:20], ttl)
            except Exception as e:
                logger.debug("Redis SET error: %s", str(e)[:100])

        # Always write to in-memory fallback too
        self._fallback[key] = data

    async def invalidate(self, pattern: str):
        """Delete keys matching pattern."""
        if self._available and self._redis:
            try:
                keys = []
                async for key in self._redis.scan_iter(match=pattern):
                    keys.append(key)
                if keys:
                    await self._redis.delete(*keys)
                    logger.info("Cache invalidated %d keys matching '%s'", len(keys), pattern)
            except Exception as e:
                logger.debug("Redis invalidate error: %s", str(e)[:100])


# Singleton instance
cache_service = CacheService()
