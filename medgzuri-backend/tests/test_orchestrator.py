"""Tests for orchestrator routing and input parsing."""

import pytest

from app.orchestrator.router import (
    OrchestratorRouter,
    _parse_clinic_input,
    _parse_geography,
    _parse_research_input,
    _parse_symptoms_input,
)
from app.orchestrator.schemas import SearchRequest


class TestInputParsing:
    """Tests for backward-compatible input parsing."""

    def test_research_old_format(self):
        data = {
            "diagnosis": "lung cancer",
            "ageGroup": "adult",
            "researchType": "interventional",
            "regions": ["europe"],
        }
        inp = _parse_research_input(data)
        assert inp.diagnosis == "lung cancer"
        assert inp.age_group == "adult"
        assert inp.study_type == "interventional"
        assert inp.geography == "europe"

    def test_research_new_format(self):
        data = {
            "diagnosis": "breast cancer",
            "age_group": "elderly",
            "study_type": "all",
            "geography": "usa",
        }
        inp = _parse_research_input(data)
        assert inp.age_group == "elderly"
        assert inp.geography == "usa"

    def test_symptoms_old_format(self):
        data = {
            "symptoms": "headache and dizziness",
            "age": 45,
            "sex": "male",
            "existingConditions": "hypertension",
            "medications": "amlodipine",
        }
        inp = _parse_symptoms_input(data)
        assert inp.symptoms_text == "headache and dizziness"
        assert inp.existing_diagnoses == "hypertension"
        assert inp.current_medications == "amlodipine"

    def test_symptoms_new_format(self):
        data = {
            "symptoms_text": "chest pain",
            "age": 60,
            "sex": "female",
        }
        inp = _parse_symptoms_input(data)
        assert inp.symptoms_text == "chest pain"

    def test_clinics_old_format_string_countries(self):
        data = {
            "diagnosis": "brain tumor",
            "countries": "germany,turkey",
            "budget": "moderate",
        }
        inp = _parse_clinic_input(data)
        assert inp.diagnosis_or_treatment == "brain tumor"
        assert len(inp.preferred_countries) == 2
        assert "germany" in inp.preferred_countries

    def test_clinics_new_format(self):
        data = {
            "diagnosis_or_treatment": "brain tumor",
            "preferred_countries": ["germany"],
        }
        inp = _parse_clinic_input(data)
        assert inp.preferred_countries == ["germany"]

    def test_geography_list(self):
        assert _parse_geography(["europe", "turkey"]) == "europe,turkey"

    def test_geography_string(self):
        assert _parse_geography("europe") == "europe"

    def test_geography_empty(self):
        assert _parse_geography([]) == "worldwide"
        assert _parse_geography("") == "worldwide"
        assert _parse_geography(None) == "worldwide"


class TestOrchestratorRouter:
    """Tests for the router in demo mode."""

    @pytest.mark.asyncio
    async def test_demo_research(self):
        router = OrchestratorRouter()
        req = SearchRequest(type="research", data={"diagnosis": "lung cancer"})
        result = await router.route(req)
        assert result.isDemo is True
        assert len(result.items) > 0
        assert "სადემონსტრაციო" in result.meta

    @pytest.mark.asyncio
    async def test_demo_symptoms(self):
        router = OrchestratorRouter()
        req = SearchRequest(type="symptoms", data={"symptoms": "headache"})
        result = await router.route(req)
        assert result.isDemo is True

    @pytest.mark.asyncio
    async def test_demo_clinics(self):
        router = OrchestratorRouter()
        req = SearchRequest(type="clinics", data={"diagnosis": "brain tumor"})
        result = await router.route(req)
        assert result.isDemo is True
        assert len(result.items) > 0

    @pytest.mark.asyncio
    async def test_invalid_type(self):
        router = OrchestratorRouter()
        req = SearchRequest(type="invalid")
        result = await router.route(req)
        assert "არასწორი" in result.meta

    @pytest.mark.asyncio
    async def test_empty_request(self):
        router = OrchestratorRouter()
        req = SearchRequest()
        result = await router.route(req)
        assert "არასწორი" in result.meta
