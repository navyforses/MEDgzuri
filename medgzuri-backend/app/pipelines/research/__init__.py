"""Pipeline A — Research Search.

Flow: A1 (Term Normalizer) → [A2 (Clinical Trials) || A3 (Literature)] → A4 (Aggregator) → A5 (Report)
"""

import asyncio
import logging

from app.orchestrator.schemas import ResearchInput, SearchResponse
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.report_generator import ResearchReportGenerator
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
        self.report_gen = ResearchReportGenerator()

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

        # A5: Generate report
        try:
            report = await self.report_gen.generate(
                scored_results=scored,
                literature=literature,
                original_query=inp.diagnosis,
            )
            logger.info("Pipeline A complete | items=%d", len(report.items))
            return report
        except Exception as e:
            logger.error("Pipeline A | A5 failed | %s", str(e)[:200])
            return SearchResponse(
                meta="ანგარიშის გენერაცია ვერ მოხერხდა.",
                items=[], disclaimer=DISCLAIMER,
            )
