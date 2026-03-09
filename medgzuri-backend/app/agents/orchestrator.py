"""Agent 5: Orchestrator — coordinates all agents in sequence.

Flow: Translator → Researcher → Analyst → Advisor → Translator
Handles errors at each stage with graceful fallback.
"""

import logging
import time
from typing import Any

from pydantic import BaseModel, Field

from app.agents.advisor import AdvisorAgent, PatientProfile, Recommendations
from app.agents.analyst import AnalystAgent, AnalyzedResults
from app.agents.researcher import RawResults, ResearcherAgent
from app.agents.translator import TranslatorAgent
from app.orchestrator.schemas import (
    ComparisonTable,
    ResultItem,
    SearchResponse,
    TipItem,
)
from app.services.compliance_guard import validate

logger = logging.getLogger(__name__)


class AgentPerformance(BaseModel):
    """Tracks execution time for each agent."""
    translator_query_ms: int = 0
    researcher_ms: int = 0
    analyst_ms: int = 0
    advisor_ms: int = 0
    translator_results_ms: int = 0
    total_ms: int = 0


class FinalResponse(BaseModel):
    """Internal model before converting to SearchResponse."""
    search_response: SearchResponse
    performance: AgentPerformance
    agent_errors: list[str] = Field(default_factory=list)


class OrchestratorAgent:
    """Coordinates all agents: Translator → Researcher → Analyst → Advisor → Translator."""

    def __init__(self) -> None:
        self.translator = TranslatorAgent()
        self.researcher = ResearcherAgent()
        self.analyst = AnalystAgent()
        self.advisor = AdvisorAgent()

    async def process_query(
        self,
        query: str,
        query_type: str | None = None,
        profile: PatientProfile | None = None,
    ) -> FinalResponse:
        """Process a medical query through the full agent pipeline.

        Args:
            query: User query (Georgian or English).
            query_type: Override auto-detection: rare_disease | drug | latest | general.
            profile: Optional patient profile for personalization.

        Returns:
            FinalResponse with SearchResponse, performance metrics, and any errors.
        """
        perf = AgentPerformance()
        errors: list[str] = []
        total_start = time.monotonic()

        # ═══════════════ STEP 1: Translate query (KA → EN) ═══════════════
        step_start = time.monotonic()
        try:
            english_query = await self.translator.translate_query(query)
            if not english_query or english_query == query:
                # Query might already be in English or translation failed
                english_query = query
        except Exception as e:
            errors.append(f"Translator(query): {str(e)[:100]}")
            english_query = query
            logger.warning("Translator failed on query, using original: %s", str(e)[:100])
        perf.translator_query_ms = int((time.monotonic() - step_start) * 1000)

        logger.info(
            "Orchestrator | query='%s' → '%s' | type=%s",
            query[:40], english_query[:40], query_type or "auto",
        )

        # ═══════════════ STEP 2: Research ═══════════════
        step_start = time.monotonic()
        raw_results = RawResults()
        try:
            raw_results = await self.researcher.research(english_query, query_type)
        except Exception as e:
            errors.append(f"Researcher: {str(e)[:100]}")
            logger.error("Researcher failed: %s", str(e)[:200])
        perf.researcher_ms = int((time.monotonic() - step_start) * 1000)

        all_items = raw_results.all_items()

        if not all_items:
            # No results — return early with a helpful message
            perf.total_ms = int((time.monotonic() - total_start) * 1000)
            return FinalResponse(
                search_response=SearchResponse(
                    meta=f"სამედიცინო ძიება: {query}",
                    items=[],
                    summary="სამწუხაროდ, ამ მოთხოვნაზე შედეგები არ მოიძებნა. გთხოვთ სცადოთ სხვა ფორმულირება.",
                    disclaimer="⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
                ),
                performance=perf,
                agent_errors=errors,
            )

        # ═══════════════ STEP 3: Analyze ═══════════════
        step_start = time.monotonic()
        analyzed = AnalyzedResults()
        try:
            analyzed = await self.analyst.analyze(all_items)
        except Exception as e:
            errors.append(f"Analyst: {str(e)[:100]}")
            logger.warning("Analyst failed, using ungraded results: %s", str(e)[:100])
            analyzed.graded_items = all_items
        perf.analyst_ms = int((time.monotonic() - step_start) * 1000)

        # ═══════════════ STEP 4: Advise ═══════════════
        step_start = time.monotonic()
        recommendations = Recommendations()
        try:
            recommendations = await self.advisor.advise(
                analyzed.graded_items,
                analyzed.key_findings,
                analyzed.consensus_points,
                profile,
            )
        except Exception as e:
            errors.append(f"Advisor: {str(e)[:100]}")
            logger.warning("Advisor failed: %s", str(e)[:100])
        perf.advisor_ms = int((time.monotonic() - step_start) * 1000)

        # ═══════════════ STEP 5: Translate results (EN → KA) ═══════════════
        step_start = time.monotonic()
        try:
            analyzed.graded_items = await self.translator.translate_results(analyzed.graded_items)
            if analyzed.key_findings:
                analyzed.key_findings = await self.translator.translate_findings(analyzed.key_findings)
        except Exception as e:
            errors.append(f"Translator(results): {str(e)[:100]}")
            logger.warning("Translator failed on results: %s", str(e)[:100])
        perf.translator_results_ms = int((time.monotonic() - step_start) * 1000)

        perf.total_ms = int((time.monotonic() - total_start) * 1000)

        # ═══════════════ BUILD RESPONSE ═══════════════
        response = self._build_response(
            query, analyzed, recommendations, raw_results, perf,
        )

        # Apply compliance guard
        response = validate(response)

        logger.info(
            "Orchestrator done | items=%d | %dms | errors=%d",
            len(response.items), perf.total_ms, len(errors),
        )

        return FinalResponse(
            search_response=response,
            performance=perf,
            agent_errors=errors,
        )

    def _build_response(
        self,
        query: str,
        analyzed: AnalyzedResults,
        recommendations: Recommendations,
        raw_results: RawResults,
        perf: AgentPerformance,
    ) -> SearchResponse:
        """Convert agent outputs into SearchResponse format."""
        items: list[ResultItem] = []

        for item in analyzed.graded_items[:20]:
            title = item.get("title_ka", item.get("title", ""))
            body = item.get("body_ka", item.get("body", item.get("abstract", item.get("abstract_summary", ""))))
            source = item.get("_source", item.get("source", ""))
            url = item.get("url", item.get("source_url", ""))

            # Build tags
            tags = []
            if item.get("evidence_level"):
                tags.append(f"Level {item['evidence_level']}")
            if item.get("_source"):
                tags.append(item["_source"])
            if item.get("phase"):
                tags.append(item["phase"])
            if item.get("status"):
                tags.append(item["status"])

            items.append(ResultItem(
                title=title,
                source=source,
                body=body[:1000] if body else "",
                tags=tags,
                url=url,
                evidence_level=item.get("evidence_level", ""),
                evidence_label=item.get("evidence_label", ""),
                phase=item.get("phase", ""),
            ))

        # Build comparison table from advisor
        comparison_table = None
        if recommendations.comparison_table and recommendations.comparison_table.get("headers"):
            comparison_table = ComparisonTable(
                headers=recommendations.comparison_table.get("headers", []),
                rows=recommendations.comparison_table.get("rows", []),
            )

        # Build action steps as tips
        next_steps = [
            TipItem(text=step, icon="→") for step in recommendations.action_steps[:5]
        ]

        # Warnings
        tips = [TipItem(text=w, icon="⚠️") for w in recommendations.warnings[:3]]

        # Sources info
        sources_str = ", ".join(raw_results.sources_queried)
        meta = f"სამედიცინო ძიება: {query} | წყაროები: {sources_str}"

        return SearchResponse(
            meta=meta,
            items=items,
            summary=recommendations.summary,
            executive_summary=recommendations.summary,
            comparison_table=comparison_table,
            action_steps=recommendations.action_steps,
            tips=tips,
            nextSteps=next_steps,
            disclaimer="⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
        )
