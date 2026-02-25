"""Orchestrator — routes incoming requests to the correct pipeline.

Responsibilities:
  - Validate input (empty fields, format)
  - Classify request type (research / symptoms / clinics)
  - Dispatch to the appropriate pipeline
  - Return demo data when in demo mode
"""

import logging
from typing import Any

from app.config import settings
from app.orchestrator.schemas import (
    ClinicInput,
    ResearchInput,
    ResultItem,
    SearchRequest,
    SearchResponse,
    SymptomsInput,
    TipItem,
)

logger = logging.getLogger(__name__)


class OrchestratorRouter:
    """Main dispatcher — maps request type to pipeline execution."""

    async def route(self, request: SearchRequest) -> SearchResponse:
        pipeline_type = request.get_pipeline_type()

        if not pipeline_type:
            return _error_response("არასწორი მოთხოვნის ტიპი.")

        # Extract typed input from the request
        data = request.data or {}
        logger.info("Orchestrator routing | pipeline=%s", pipeline_type)

        # Demo mode
        if settings.is_demo_mode:
            logger.info("Demo mode active — returning mock data")
            return _demo_response(pipeline_type, data)

        # Route to pipeline
        if pipeline_type == "research_search":
            return await self._run_research(data)
        elif pipeline_type == "symptom_navigation":
            return await self._run_symptoms(data)
        elif pipeline_type == "clinic_search":
            return await self._run_clinics(data)
        else:
            return _error_response("უცნობი ძიების ტიპი.")

    async def _run_research(self, data: dict[str, Any]) -> SearchResponse:
        """Pipeline A — Research Search."""
        inp = _parse_research_input(data)
        if not inp.diagnosis:
            return _error_response("გთხოვთ მიუთითოთ დიაგნოზი ან სამედიცინო მდგომარეობა.")

        from app.pipelines.research import ResearchPipeline
        pipeline = ResearchPipeline()
        return await pipeline.execute(inp)

    async def _run_symptoms(self, data: dict[str, Any]) -> SearchResponse:
        """Pipeline B — Symptom Navigation."""
        inp = _parse_symptoms_input(data)
        if not inp.symptoms_text:
            return _error_response("გთხოვთ აღწეროთ სიმპტომები.")

        from app.pipelines.symptoms import SymptomPipeline
        pipeline = SymptomPipeline()
        return await pipeline.execute(inp)

    async def _run_clinics(self, data: dict[str, Any]) -> SearchResponse:
        """Pipeline C — Clinic Search."""
        inp = _parse_clinic_input(data)
        if not inp.diagnosis_or_treatment:
            return _error_response("გთხოვთ მიუთითოთ დიაგნოზი ან მკურნალობის ტიპი.")

        from app.pipelines.clinics import ClinicPipeline
        pipeline = ClinicPipeline()
        return await pipeline.execute(inp)


# ═══════════════ INPUT PARSING (old format → new) ═══════════════

def _parse_research_input(data: dict) -> ResearchInput:
    return ResearchInput(
        diagnosis=data.get("diagnosis", ""),
        age_group=data.get("ageGroup", data.get("age_group", "any")),
        study_type=data.get("researchType", data.get("study_type", "all")),
        additional_context=data.get("context", data.get("additional_context", "")),
        geography=_parse_geography(data.get("regions", data.get("geography", "worldwide"))),
    )


def _parse_symptoms_input(data: dict) -> SymptomsInput:
    return SymptomsInput(
        symptoms_text=data.get("symptoms", data.get("symptoms_text", "")),
        age=data.get("age"),
        sex=data.get("sex", ""),
        existing_diagnoses=data.get("existingConditions", data.get("existing_diagnoses", "")),
        current_medications=data.get("medications", data.get("current_medications", "")),
    )


def _parse_clinic_input(data: dict) -> ClinicInput:
    countries = data.get("countries", data.get("preferred_countries", []))
    if isinstance(countries, str):
        countries = [c.strip() for c in countries.split(",") if c.strip()]
    return ClinicInput(
        diagnosis_or_treatment=data.get("diagnosis", data.get("diagnosis_or_treatment", "")),
        preferred_countries=countries,
        budget_range=data.get("budget", data.get("budget_range", "no_preference")),
        language_preference=data.get("language", data.get("language_preference", "any")),
        additional_requirements=data.get("notes", data.get("additional_requirements", "")),
    )


def _parse_geography(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(value) if value else "worldwide"
    return str(value) if value else "worldwide"


# ═══════════════ HELPERS ═══════════════

def _error_response(msg: str) -> SearchResponse:
    return SearchResponse(
        meta=msg,
        items=[],
        disclaimer="⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
    )


def _demo_response(pipeline_type: str, data: dict) -> SearchResponse:
    """Return mock data for demo/dev mode."""
    from app.orchestrator.demo_data import get_demo_data
    return get_demo_data(pipeline_type, data)
