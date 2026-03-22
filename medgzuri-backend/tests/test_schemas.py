"""Tests for Pydantic schemas and request routing."""

import pytest

from app.orchestrator.schemas import (
    ClinicInput,
    ClinicResult,
    ClinicWithRating,
    NormalizedTerms,
    ParsedSymptoms,
    ResearchInput,
    ResultItem,
    SearchRequest,
    SearchResponse,
    SymptomsInput,
)


class TestSearchRequest:
    """Tests for backward-compatible SearchRequest model."""

    def test_old_format_research(self):
        req = SearchRequest(type="research", data={"diagnosis": "lung cancer"})
        assert req.get_pipeline_type() == "research_search"

    def test_old_format_symptoms(self):
        req = SearchRequest(type="symptoms", data={"symptoms": "headache"})
        assert req.get_pipeline_type() == "symptom_navigation"

    def test_old_format_clinics(self):
        req = SearchRequest(type="clinics", data={"diagnosis": "brain tumor"})
        assert req.get_pipeline_type() == "clinic_search"

    def test_new_format_research(self):
        req = SearchRequest(source_tab="research_search")
        assert req.get_pipeline_type() == "research_search"

    def test_new_format_takes_priority(self):
        req = SearchRequest(type="clinics", source_tab="research_search")
        assert req.get_pipeline_type() == "research_search"

    def test_unknown_type(self):
        req = SearchRequest(type="unknown")
        assert req.get_pipeline_type() == ""

    def test_empty_request(self):
        req = SearchRequest()
        assert req.get_pipeline_type() == ""


class TestResearchInput:
    def test_defaults(self):
        inp = ResearchInput(diagnosis="lung cancer")
        assert inp.age_group == "any"
        assert inp.study_type == "all"
        assert inp.geography == "worldwide"

    def test_full_input(self):
        inp = ResearchInput(
            diagnosis="ფილტვის კიბო",
            age_group="adult",
            study_type="interventional",
            geography="europe",
            additional_context="immunotherapy focus",
        )
        assert inp.diagnosis == "ფილტვის კიბო"
        assert inp.geography == "europe"


class TestSymptomsInput:
    def test_minimal(self):
        inp = SymptomsInput(symptoms_text="თავის ტკივილი")
        assert inp.symptoms_text == "თავის ტკივილი"
        assert inp.age is None
        assert inp.sex == ""

    def test_full(self):
        inp = SymptomsInput(
            symptoms_text="headache and blurred vision",
            age=45, sex="male",
            existing_diagnoses="hypertension",
            current_medications="amlodipine",
        )
        assert inp.age == 45


class TestClinicInput:
    def test_defaults(self):
        inp = ClinicInput(diagnosis_or_treatment="brain tumor")
        assert inp.preferred_countries == []
        assert inp.budget_range == "no_preference"

    def test_with_countries(self):
        inp = ClinicInput(
            diagnosis_or_treatment="brain tumor",
            preferred_countries=["germany", "turkey"],
        )
        assert len(inp.preferred_countries) == 2


class TestNormalizedTerms:
    def test_defaults(self):
        terms = NormalizedTerms()
        assert terms.english_primary == ""
        assert terms.english_terms == []
        assert terms.mesh_terms == []

    def test_full(self):
        terms = NormalizedTerms(
            original_query="ფილტვის კიბო",
            english_primary="lung cancer",
            english_terms=["lung cancer", "NSCLC"],
            mesh_terms=["Carcinoma, Non-Small-Cell Lung"],
            icd10="C34",
            search_queries={"pubmed": "lung cancer immunotherapy"},
        )
        assert terms.icd10 == "C34"


class TestSearchResponse:
    def test_empty_response(self):
        resp = SearchResponse(meta="test", items=[])
        assert resp.items == []
        assert resp.isDemo is False

    def test_demo_response(self):
        resp = SearchResponse(
            meta="Demo", isDemo=True,
            items=[ResultItem(title="Test", body="Body")],
            disclaimer="⚕️ Test disclaimer",
        )
        assert resp.isDemo is True
        assert len(resp.items) == 1

    def test_serialization(self):
        resp = SearchResponse(
            meta="Results",
            items=[ResultItem(title="Title", source="Source", body="Body")],
        )
        data = resp.model_dump(exclude_none=True)
        assert data["meta"] == "Results"
        assert len(data["items"]) == 1


class TestClinicWithRating:
    def test_inherits_clinic_result(self):
        clinic = ClinicWithRating(
            name="Charité", country="Germany", city="Berlin",
            active_trials_count=5,
            rating_score=85.0, publication_count=10, jci_accredited=True,
        )
        assert clinic.name == "Charité"
        assert clinic.rating_score == 85.0
        assert clinic.jci_accredited is True


class TestParsedSymptoms:
    def test_with_red_flags(self):
        ps = ParsedSymptoms(
            extracted_symptoms=[{"ka": "თავის ტკივილი", "en": "headache"}],
            red_flags=["sudden severe headache", "vision loss"],
        )
        assert len(ps.red_flags) == 2
