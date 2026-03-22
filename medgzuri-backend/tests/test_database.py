"""Tests for database models and schema."""

import uuid
from datetime import datetime, timezone

import pytest

from app.models.cached_results import CachedResult
from app.models.search_history import SearchHistory


class TestSearchHistoryModel:
    def test_create_instance(self):
        record = SearchHistory(
            pipeline_type="research_search",
            input_data={"diagnosis": "lung cancer"},
            response_data={"meta": "test", "items": []},
            execution_time_ms=1500,
            client_ip_hash="abc123",
        )
        assert record.pipeline_type == "research_search"
        assert record.input_data["diagnosis"] == "lung cancer"
        assert record.execution_time_ms == 1500
        assert record.client_ip_hash == "abc123"

    def test_explicit_values(self):
        """Verify explicit values are stored correctly."""
        record = SearchHistory(
            pipeline_type="symptom_navigation",
            input_data={},
            response_data={},
            execution_time_ms=0,
            source="cache",
            client_ip_hash="hash123",
        )
        assert record.source == "cache"
        assert record.client_ip_hash == "hash123"

    def test_all_pipeline_types(self):
        for pt in ["research_search", "symptom_navigation", "clinic_search"]:
            record = SearchHistory(
                pipeline_type=pt,
                input_data={},
                response_data={},
                execution_time_ms=100,
            )
            assert record.pipeline_type == pt


class TestCachedResultModel:
    def test_create_instance(self):
        expires = datetime(2026, 6, 1, tzinfo=timezone.utc)
        record = CachedResult(
            cache_key="mg:abcdef1234567890",
            pipeline_type="research_search",
            result_data={"meta": "cached result", "items": []},
            expires_at=expires,
            hit_count=5,
        )
        assert record.cache_key == "mg:abcdef1234567890"
        assert record.pipeline_type == "research_search"
        assert record.expires_at == expires
        assert record.hit_count == 5

    def test_explicit_hit_count(self):
        record = CachedResult(
            cache_key="mg:test",
            pipeline_type="clinic_search",
            result_data={},
            expires_at=datetime.now(timezone.utc),
            hit_count=0,
        )
        assert record.hit_count == 0
