"""Tests for translation service — dictionary lookups (no LLM/API required)."""

import pytest

from app.services.translation import TranslationService


@pytest.fixture
def service():
    return TranslationService()


class TestDictionaryLookup:
    def test_ka_to_en_known_term(self, service):
        result = service._dict_lookup("ფილტვის კიბო", "ka", "en")
        assert result == "lung cancer"

    def test_ka_to_en_medication(self, service):
        result = service._dict_lookup("პარაცეტამოლი", "ka", "en")
        assert result == "paracetamol"

    def test_ka_to_en_unknown(self, service):
        result = service._dict_lookup("უცნობი ტერმინი", "ka", "en")
        assert result is None

    def test_en_to_ka(self, service):
        result = service._dict_lookup("lung cancer", "en", "ka")
        assert result == "ფილტვის კიბო"

    def test_empty_text(self, service):
        result = service._dict_lookup("", "ka", "en")
        assert result is None


class TestTranslateAsync:
    @pytest.mark.asyncio
    async def test_translate_known_term(self, service):
        """Dictionary hit should return immediately without LLM."""
        result = await service.translate("დიაბეტი", source="ka", target="en")
        assert result == "diabetes mellitus"

    @pytest.mark.asyncio
    async def test_translate_empty_string(self, service):
        result = await service.translate("", source="ka", target="en")
        assert result == ""

    @pytest.mark.asyncio
    async def test_translate_medical_term(self, service):
        result = await service.translate_medical_term("მიგრენი")
        assert result == "migraine"


class TestBatchTranslate:
    @pytest.mark.asyncio
    async def test_batch_all_known(self, service):
        terms = ["ფილტვის კიბო", "დიაბეტი", "მიგრენი"]
        results = await service.batch_translate(terms, source="ka", target="en")
        assert results == ["lung cancer", "diabetes mellitus", "migraine"]

    @pytest.mark.asyncio
    async def test_batch_mixed(self, service):
        """Unknown terms should fall back to originals (no LLM in test)."""
        terms = ["ფილტვის კიბო", "უცნობი ტერმინი"]
        results = await service.batch_translate(terms, source="ka", target="en")
        assert results[0] == "lung cancer"
        # Unknown term falls back to original since no LLM key
        assert results[1] == "უცნობი ტერმინი"

    @pytest.mark.asyncio
    async def test_batch_empty(self, service):
        results = await service.batch_translate([], source="ka", target="en")
        assert results == []
