"""Pipeline C — Clinic Search.

Flow: C1 (Query Builder) → [C2 (Clinic Finder) || C3 (Rating) || C4 (Cost)] → C5 (Report)
Note: C3 and C4 depend on C2's output, so actual flow is: C1 → C2 → [C3 || C4] → C5
"""

import asyncio
import logging

from app.orchestrator.schemas import ClinicInput, SearchResponse
from app.pipelines.clinics.clinic_finder import ClinicFinder
from app.pipelines.clinics.clinic_report import ClinicReportGenerator
from app.pipelines.clinics.cost_agent import ClinicCostAgent
from app.pipelines.clinics.query_builder import ClinicQueryBuilder
from app.pipelines.clinics.rating_agent import ClinicRatingAgent

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ ფასები საინფორმაციო ხასიათისაა. მედგზური არ ანაცვლებს ექიმის კონსულტაციას."


class ClinicPipeline:
    """Orchestrates the full clinic search pipeline."""

    def __init__(self):
        self.query_builder = ClinicQueryBuilder()
        self.finder = ClinicFinder()
        self.rater = ClinicRatingAgent()
        self.cost_agent = ClinicCostAgent()
        self.report_gen = ClinicReportGenerator()

    async def execute(self, inp: ClinicInput) -> SearchResponse:
        logger.info("Pipeline C | treatment=%s", inp.diagnosis_or_treatment)

        # C1: Build queries
        try:
            query_data = await self.query_builder.build(inp)
        except Exception as e:
            logger.error("Pipeline C | C1 failed | %s", str(e)[:200])
            return SearchResponse(meta="შეცდომა.", items=[], disclaimer=DISCLAIMER)

        # C2: Find clinics
        try:
            clinics = await self.finder.find(query_data, inp.preferred_countries)
        except Exception as e:
            logger.error("Pipeline C | C2 failed | %s", str(e)[:200])
            clinics = []

        if not clinics:
            return SearchResponse(
                meta="კლინიკები ვერ მოიძებნა. გთხოვთ სცადოთ სხვა საძიებო ტერმინი.",
                items=[], disclaimer=DISCLAIMER,
            )

        # C3 + C4: Rate and cost in parallel
        condition = query_data.get("english_primary", inp.diagnosis_or_treatment)
        rating_task = self.rater.rate(clinics, condition)
        # C4 needs rated clinics, but can start with basic data
        # For now, run C3 first, then C4
        try:
            rated_clinics = await rating_task
        except Exception as e:
            logger.warning("Pipeline C | C3 failed | %s", str(e)[:200])
            rated_clinics = []

        try:
            cost_data = await self.cost_agent.estimate(rated_clinics, condition)
        except Exception as e:
            logger.warning("Pipeline C | C4 failed | %s", str(e)[:200])
            cost_data = []

        # C5: Generate report
        try:
            report = await self.report_gen.generate(
                rated_clinics=rated_clinics,
                cost_data=cost_data,
                original_query=inp.diagnosis_or_treatment,
            )
            logger.info("Pipeline C complete | items=%d", len(report.items))
            return report
        except Exception as e:
            logger.error("Pipeline C | C5 failed | %s", str(e)[:200])
            return SearchResponse(meta="ანგარიშის გენერაცია ვერ მოხერხდა.", items=[], disclaimer=DISCLAIMER)
