"""Orchestrator — routes incoming requests to the correct pipeline.

Responsibilities:
  - Validate input (empty fields, format)
  - Classify request type (research / symptoms / clinics)
  - Check cache before running pipeline
  - Dispatch to the appropriate pipeline
  - Cache results after pipeline execution
  - Return demo data when in demo mode
"""

import logging
from typing import Any

from app.config import settings
from app.orchestrator.schemas import (
    ClinicInput,
    ReportSection,
    ResearchInput,
    ResultItem,
    SearchRequest,
    SearchResponse,
    SymptomsInput,
    TipItem,
)
from app.services.cache import cache_service

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

        # Check cache (skip for reports — they're generated from existing results)
        if pipeline_type != "report_generation":
            cache_key = cache_service.make_key(pipeline_type, data)
            cached = await cache_service.get(cache_key)
            if cached:
                logger.info("Cache hit | pipeline=%s", pipeline_type)
                response = SearchResponse(**cached)
                return response

        # Route to pipeline
        if pipeline_type == "research_search":
            result = await self._run_research(data)
        elif pipeline_type == "symptom_navigation":
            result = await self._run_symptoms(data)
        elif pipeline_type == "clinic_search":
            result = await self._run_clinics(data)
        elif pipeline_type == "report_generation":
            return await self._run_report(data)
        else:
            return _error_response("უცნობი ძიების ტიპი.")

        # Cache the result
        if result.items:
            ttl = cache_service.get_ttl(pipeline_type)
            result_data = result.model_dump(exclude_none=True)
            await cache_service.set(cache_key, result_data, ttl)

        return result

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

    async def _run_report(self, data: dict[str, Any]) -> SearchResponse:
        """Report generation — structures search results into a formal report."""
        import json
        report_type = data.get("reportType", data.get("report_type", "research"))
        search_result = data.get("searchResult", data.get("search_result", {}))

        if not search_result:
            return _error_response("ძიების შედეგები არ მოიძებნა ანგარიშის გენერაციისთვის.")

        from app.services.llm_client import call_sonnet_json, load_prompt

        try:
            system_prompt = load_prompt("report")
        except FileNotFoundError:
            system_prompt = _default_report_prompt()

        user_message = f"ანგარიშის ტიპი: {report_type}\nძიების შედეგები: {json.dumps(search_result, ensure_ascii=False)}"

        try:
            parsed = await call_sonnet_json(system_prompt, user_message, max_tokens=4000)
            if parsed and parsed.get("sections"):
                return SearchResponse(
                    title=parsed.get("title", "სამედიცინო ანგარიში"),
                    sections=[
                        ReportSection(heading=s.get("heading", ""), content=s.get("content", ""))
                        for s in parsed["sections"]
                    ],
                    disclaimer=parsed.get("disclaimer", "ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას."),
                )
        except Exception as e:
            logger.error("Report generation failed: %s", str(e)[:200])

        # Fallback: build a simple report from the search result
        return _fallback_report(report_type, search_result)


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


def _default_report_prompt() -> str:
    """Fallback report prompt when prompts/report.txt is missing."""
    return (
        "შენ ხარ მედგზურის სამედიცინო ანგარიშის ავტორი. მოგეცემა ძიების შედეგები და შენ უნდა "
        "შექმნა სრული, პროფესიული სამედიცინო ანგარიში ქართულ ენაზე.\n\n"
        "ანგარიშის სტრუქტურა:\n"
        "1. შესავალი — თემის მოკლე აღწერა\n"
        "2. მიმოხილვა — ძირითადი მიგნებები\n"
        "3. დეტალური ანალიზი — თითოეული აღმოჩენის განხილვა\n"
        "4. რეკომენდაციები — კონკრეტული რჩევები\n"
        "5. დასკვნა — შეჯამება\n\n"
        "პასუხი მხოლოდ JSON ფორმატში:\n"
        '{"title": "სათაური", "sections": [{"heading": "სექცია", "content": "ტექსტი"}], '
        '"disclaimer": "სამედიცინო პასუხისმგებლობის უარყოფა"}'
    )


def _fallback_report(report_type: str, search_result: dict) -> SearchResponse:
    """Build a simple structured report from raw search results when LLM fails."""
    meta = search_result.get("meta", "სამედიცინო მოთხოვნა")
    items = search_result.get("items", [])

    sections = [
        ReportSection(heading="შესავალი", content=f"წინამდებარე ანგარიში მომზადებულია ძიების შედეგების ({meta}) საფუძველზე."),
    ]

    if items:
        body_parts = []
        for item in items[:10]:
            title = item.get("title", "")
            body = item.get("body", "")
            source = item.get("source", "")
            entry = f"**{title}**" if title else ""
            if source:
                entry += f" ({source})"
            if body:
                entry += f"\n{body}"
            if entry:
                body_parts.append(entry)
        sections.append(ReportSection(heading="მიმოხილვა", content="\n\n".join(body_parts)))

    sections.append(ReportSection(
        heading="რეკომენდაციები",
        content="რეკომენდირებულია კონსულტაცია შესაბამის სამედიცინო სპეციალისტთან.",
    ))

    return SearchResponse(
        title=f"სამედიცინო ანგარიში — {meta}",
        sections=sections,
        disclaimer="ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას.",
    )
