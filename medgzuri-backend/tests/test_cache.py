"""Tests for cache service — in-memory fallback (no Redis required)."""

import pytest

from app.services.cache import CacheService


@pytest.fixture
def cache():
    """Fresh cache service without Redis."""
    svc = CacheService()
    return svc


class TestCacheKeyGeneration:
    def test_make_key_deterministic(self, cache):
        key1 = cache.make_key("research_search", {"diagnosis": "cancer"})
        key2 = cache.make_key("research_search", {"diagnosis": "cancer"})
        assert key1 == key2

    def test_make_key_different_input(self, cache):
        key1 = cache.make_key("research_search", {"diagnosis": "cancer"})
        key2 = cache.make_key("research_search", {"diagnosis": "diabetes"})
        assert key1 != key2

    def test_make_key_different_pipeline(self, cache):
        key1 = cache.make_key("research_search", {"diagnosis": "cancer"})
        key2 = cache.make_key("clinic_search", {"diagnosis": "cancer"})
        assert key1 != key2

    def test_make_key_prefix(self, cache):
        key = cache.make_key("research_search", {"diagnosis": "cancer"})
        assert key.startswith("mg:")

    def test_make_key_order_independent(self, cache):
        """JSON keys are sorted, so order shouldn't matter."""
        key1 = cache.make_key("research_search", {"a": "1", "b": "2"})
        key2 = cache.make_key("research_search", {"b": "2", "a": "1"})
        assert key1 == key2


class TestCacheTTL:
    def test_ttl_research(self, cache):
        ttl = cache.get_ttl("research_search")
        assert ttl == 604800  # 7 days

    def test_ttl_symptoms(self, cache):
        ttl = cache.get_ttl("symptom_navigation")
        assert ttl == 86400  # 24h

    def test_ttl_clinics(self, cache):
        ttl = cache.get_ttl("clinic_search")
        assert ttl == 2592000  # 30 days

    def test_ttl_unknown_pipeline(self, cache):
        ttl = cache.get_ttl("unknown")
        assert ttl == 86400  # default = clinical_trials TTL


class TestCacheInMemoryFallback:
    @pytest.mark.asyncio
    async def test_set_and_get(self, cache):
        """In-memory fallback should work without Redis."""
        data = {"meta": "test", "items": []}
        await cache.set("test_key", data, ttl=3600)
        result = await cache.get("test_key")
        assert result == data

    @pytest.mark.asyncio
    async def test_get_miss(self, cache):
        result = await cache.get("nonexistent_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_overwrite(self, cache):
        await cache.set("key1", {"v": 1}, ttl=3600)
        await cache.set("key1", {"v": 2}, ttl=3600)
        result = await cache.get("key1")
        assert result == {"v": 2}

    @pytest.mark.asyncio
    async def test_multiple_keys(self, cache):
        await cache.set("k1", {"a": 1}, ttl=3600)
        await cache.set("k2", {"b": 2}, ttl=3600)
        assert await cache.get("k1") == {"a": 1}
        assert await cache.get("k2") == {"b": 2}
