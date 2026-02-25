"""Tests for shared services — compliance guard, medical terms, country data."""

import pytest

from app.orchestrator.schemas import ResultItem, SearchResponse
from app.services.compliance_guard import DISCLAIMER_KA, validate
from app.utils.country_data import get_country_info
from app.utils.medical_terms import KA_TO_EN, MEDICATIONS_KA_TO_EN, translate_term


# ═══════════════ Compliance Guard ═══════════════


class TestComplianceGuard:
    def test_adds_missing_disclaimer(self):
        resp = SearchResponse(meta="test", items=[], disclaimer="")
        validated = validate(resp)
        assert validated.disclaimer == DISCLAIMER_KA

    def test_keeps_existing_disclaimer(self):
        custom = "Custom disclaimer text"
        resp = SearchResponse(meta="test", items=[], disclaimer=custom)
        validated = validate(resp)
        assert validated.disclaimer == custom

    def test_detects_diagnosis_pattern_ka(self):
        """Should log warning (not raise) for diagnosis-like content."""
        resp = SearchResponse(
            meta="test",
            items=[ResultItem(title="Test", body="თქვენ გაქვთ დიაბეტის დაავადება")],
            disclaimer=DISCLAIMER_KA,
        )
        # Should not raise, just log
        validated = validate(resp)
        assert validated is not None

    def test_detects_prescription_pattern(self):
        """Should log warning for prescription-like content."""
        resp = SearchResponse(
            meta="test",
            items=[ResultItem(title="Test", body="take aspirin medication daily")],
            disclaimer=DISCLAIMER_KA,
        )
        validated = validate(resp)
        assert validated is not None


# ═══════════════ Medical Terms ═══════════════


class TestMedicalTerms:
    def test_translate_known_term(self):
        assert translate_term("ფილტვის კიბო") == "lung cancer"
        assert translate_term("დიაბეტი") == "diabetes mellitus"
        assert translate_term("მიგრენი") == "migraine"

    def test_translate_unknown_term(self):
        assert translate_term("непонятный термин") is None
        assert translate_term("") is None

    def test_ka_to_en_completeness(self):
        """Verify dictionary has entries for key specialties."""
        # Oncology
        assert "კიბო" in KA_TO_EN
        assert "ქიმიოთერაპია" in KA_TO_EN
        # Cardiology
        assert "ინფარქტი" in KA_TO_EN
        assert "ჰიპერტენზია" in KA_TO_EN
        # Neurology
        assert "ეპილეფსია" in KA_TO_EN
        assert "ინსულტი" in KA_TO_EN
        # Symptoms
        assert "ცხელება" in KA_TO_EN
        assert "ტკივილი" in KA_TO_EN

    def test_medications_dict(self):
        assert "პარაცეტამოლი" in MEDICATIONS_KA_TO_EN
        assert MEDICATIONS_KA_TO_EN["პარაცეტამოლი"] == "paracetamol"


# ═══════════════ Country Data ═══════════════


class TestCountryData:
    def test_get_turkey(self):
        info = get_country_info("turkey")
        assert info["visa_required"] is False
        assert info["flight_hours"] == 2

    def test_get_germany(self):
        info = get_country_info("Germany")  # case-insensitive
        assert info["visa_required"] is True
        assert info["visa_type"] == "შენგენი"

    def test_get_usa_alias(self):
        info = get_country_info("United States")
        assert info["name_ka"] == "ამერიკის შეერთებული შტატები"

    def test_get_unknown(self):
        info = get_country_info("Atlantis")
        assert info == {}

    def test_accessibility_bonus(self):
        turkey = get_country_info("turkey")
        germany = get_country_info("germany")
        assert turkey["accessibility_bonus"] > germany["accessibility_bonus"]
