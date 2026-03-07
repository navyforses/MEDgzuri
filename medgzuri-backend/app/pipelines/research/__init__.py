"""Pipeline A — Research Search.

Flow: A1 (Term Normalizer) → [A2 (Clinical Trials) || A3 (Literature)] → A4 (Aggregator) → A5 (Report)
"""

import asyncio
import logging

from app.orchestrator.schemas import ResearchInput, ResultItem, SearchResponse
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.term_normalizer import TermNormalizer

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."


class ResearchPipeline:
    """Orchestrates the full research search pipeline."""

    def __init__(self):
        self.normalizer = TermNormalizer()
        self.trials_agent = ClinicalTrialsAgent()
        self.literature_agent = LiteratureSearchAgent()
        self.aggregator = ResearchAggregator()

    async def execute(self, inp: ResearchInput) -> SearchResponse:
        logger.info("Pipeline A | diagnosis=%s | geo=%s", inp.diagnosis, inp.geography)

        # A1: Normalize terms
        try:
            terms = await self.normalizer.normalize(inp)
        except Exception as e:
            logger.error("Pipeline A | A1 failed | %s", str(e)[:200])
            return SearchResponse(
                meta="ტერმინის ნორმალიზაცია ვერ მოხერხდა.",
                items=[], disclaimer=DISCLAIMER,
            )

        # A2 + A3: Parallel search
        trials_task = self.trials_agent.search(
            terms=terms,
            age_group=inp.age_group,
            geography=inp.geography,
            study_type=inp.study_type,
        )
        literature_task = self.literature_agent.search(
            terms=terms,
            original_query=inp.diagnosis,
        )

        results = await asyncio.gather(trials_task, literature_task, return_exceptions=True)

        trials = results[0] if isinstance(results[0], list) else []
        literature = results[1] if isinstance(results[1], dict) else {"articles": []}

        if isinstance(results[0], Exception):
            logger.warning("Pipeline A | A2 failed | %s", str(results[0])[:200])
        if isinstance(results[1], Exception):
            logger.warning("Pipeline A | A3 failed | %s", str(results[1])[:200])

        if not trials and not literature.get("articles"):
            logger.warning("Pipeline A | no results from A2 or A3")
            return SearchResponse(
                meta="კვლევები ვერ მოიძებნა. გთხოვთ სცადოთ სხვა საძიებო ტერმინი.",
                items=[], disclaimer=DISCLAIMER,
            )

        # A4: Aggregate and score
        try:
            scored = await self.aggregator.aggregate(
                trials=trials,
                literature=literature,
                original_query=inp.diagnosis,
            )
        except Exception as e:
            logger.error("Pipeline A | A4 failed | %s", str(e)[:200])
            scored = []

        # A5: Skip LLM report generation (causes timeouts).
        # Build response directly from scored results.
        report = self._build_response(scored, inp.diagnosis)
        logger.info("Pipeline A complete | items=%d", len(report.items))
        return report

    def _build_response(self, scored: list[dict], query: str) -> SearchResponse:
        """Build SearchResponse directly from scored results (no LLM)."""
        items = []
        for r in scored[:10]:
            data = r.get("data", {})
            if r.get("type") == "trial":
                locations = ", ".join(
                    f"{loc.get('country', '')} ({loc.get('facility', '')})"
                    for loc in data.get("locations", [])[:3]
                )
                items.append(ResultItem(
                    title=data.get("title", ""),
                    source=f"ClinicalTrials.gov | {data.get('phase', '')}",
                    body=f"**სტატუსი:** {data.get('status', '')}\n"
                         f"**ლოკაცია:** {locations}\n"
                         f"**სპონსორი:** {data.get('sponsor', '')}",
                    tags=[data.get("phase", ""), data.get("status", "")],
                    url=data.get("url", ""),
                    phase=data.get("phase", ""),
                ))
            else:
                items.append(ResultItem(
                    title=data.get("title", ""),
                    source=data.get("journal", ""),
                    body=data.get("abstract_summary", data.get("abstract", ""))[:500],
                    tags=["სტატია", str(data.get("year", ""))],
                    url=data.get("source_url", ""),
                ))

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} შედეგი: {query}",
            items=items,
            disclaimer=DISCLAIMER,
        )
