"""Pydantic models for API input/output — shared across all pipelines.

Split into: inputs, agent outputs, and final API response.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ═══════════════ FRONTEND REQUEST (backward-compatible) ═══════════════

class SearchRequest(BaseModel):
    """Accepts BOTH the old {type, data} format AND the new {source_tab, ...} format."""

    # Old format
    type: str | None = None
    data: dict[str, Any] | None = None

    # New format
    source_tab: str | None = None

    def get_pipeline_type(self) -> str:
        """Resolve to pipeline type: research_search | symptom_navigation | clinic_search."""
        if self.source_tab:
            return self.source_tab

        type_map = {
            "research": "research_search",
            "symptoms": "symptom_navigation",
            "clinics": "clinic_search",
        }
        return type_map.get(self.type or "", "")


# ═══════════════ PIPELINE INPUTS ═══════════════

class ResearchInput(BaseModel):
    diagnosis: str
    age_group: str = "any"
    study_type: str = "all"
    additional_context: str = ""
    geography: str = "worldwide"


class SymptomsInput(BaseModel):
    symptoms_text: str
    age: int | None = None
    sex: str = ""
    existing_diagnoses: str = ""
    current_medications: str = ""


class ClinicInput(BaseModel):
    diagnosis_or_treatment: str
    preferred_countries: list[str] = Field(default_factory=list)
    budget_range: str = "no_preference"
    language_preference: str = "any"
    additional_requirements: str = ""


# ═══════════════ AGENT OUTPUTS ═══════════════

class NormalizedTerms(BaseModel):
    """A1 / C1 output."""
    original_query: str = ""
    english_primary: str = ""
    english_terms: list[str] = Field(default_factory=list)
    mesh_terms: list[str] = Field(default_factory=list)
    icd10: str = ""
    synonyms: list[str] = Field(default_factory=list)
    search_queries: dict[str, str] = Field(default_factory=dict)


class ClinicalTrialResult(BaseModel):
    """A2 output — single trial."""
    nct_id: str = ""
    title: str = ""
    phase: str = ""
    status: str = ""
    conditions: list[str] = Field(default_factory=list)
    interventions: list[dict[str, str]] = Field(default_factory=list)
    locations: list[dict[str, str]] = Field(default_factory=list)
    eligibility: dict[str, Any] = Field(default_factory=dict)
    dates: dict[str, str] = Field(default_factory=dict)
    sponsor: str = ""
    enrollment: int | None = None
    source_registry: str = "ClinicalTrials.gov"
    url: str = ""


class ArticleResult(BaseModel):
    """A3 output — single article."""
    pmid: str = ""
    title: str = ""
    abstract_summary: str = ""
    journal: str = ""
    year: int | None = None
    doi: str = ""
    relevance_note: str = ""
    source_url: str = ""


class ScoredResult(BaseModel):
    """A4 output — scored and ranked."""
    id: str = ""
    type: Literal["trial", "article"] = "trial"
    score: float = 0.0
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    accessibility_index: float = 0.0
    data: dict[str, Any] = Field(default_factory=dict)


class ParsedSymptom(BaseModel):
    """B1 output — single symptom."""
    ka: str = ""
    en: str = ""
    medical: str = ""
    severity: str = "unknown"


class ParsedSymptoms(BaseModel):
    """B1 full output."""
    extracted_symptoms: list[ParsedSymptom] = Field(default_factory=list)
    patient_context: dict[str, Any] = Field(default_factory=dict)
    possible_medication_side_effects: list[dict[str, str]] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)


class ResearchDirection(BaseModel):
    """B2 output — single direction."""
    condition: str = ""
    condition_ka: str = ""
    relevance_explanation: str = ""
    matching_symptoms: list[str] = Field(default_factory=list)
    confidence: str = "possible"
    is_rare_disease: bool = False
    orphanet_code: str | None = None


class ClinicResult(BaseModel):
    """C2 output — single clinic."""
    name: str = ""
    country: str = ""
    city: str = ""
    specialization: str = ""
    website: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    active_trials_count: int = 0
    jci_accredited: bool | None = None
    languages: list[str] = Field(default_factory=list)
    source_url: str = ""


class ClinicWithRating(ClinicResult):
    """C3 enriched — clinic with rating data."""
    rating_score: float = 0.0
    publication_count: int = 0
    ranking_source: str = ""
    ranking_position: str = ""


class ClinicWithCost(BaseModel):
    """C4 enriched — cost data for a clinic."""
    clinic_name: str = ""
    estimated_treatment_cost: str = ""
    visa_required: bool | None = None
    estimated_flight_cost: str = ""
    estimated_living_cost: str = ""
    total_estimated_cost: str = ""


# ═══════════════ FINAL API RESPONSE ═══════════════

class ResultItem(BaseModel):
    """Single result item matching the frontend's expected format."""
    title: str = ""
    source: str = ""
    body: str = ""
    tags: list[str] = Field(default_factory=list)
    url: str = ""
    priority: str = ""
    rating: float | None = None
    price: str = ""
    phase: str = ""


class ComparisonTable(BaseModel):
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)


class TipItem(BaseModel):
    text: str = ""
    icon: str = ""


class SearchResponse(BaseModel):
    """Final response sent to the frontend — matches existing format."""
    meta: str = ""
    items: list[ResultItem] = Field(default_factory=list)
    summary: str = ""
    comparison: ComparisonTable | None = None
    tips: list[TipItem] = Field(default_factory=list)
    nextSteps: list[TipItem] = Field(default_factory=list)
    disclaimer: str = ""
    isDemo: bool = False
