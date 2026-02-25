"""Pipeline B — Symptom Navigation.

Flow: B1 (Symptom Parser) → B2 (Differential Analysis) → B3 (Research Matcher) → B4 (Report)
"""

import logging

from app.orchestrator.schemas import SearchResponse, SymptomsInput
from app.pipelines.symptoms.differential import DifferentialAnalysis
from app.pipelines.symptoms.navigator_report import NavigatorReportGenerator
from app.pipelines.symptoms.research_matcher import ResearchMatcher
from app.pipelines.symptoms.symptom_parser import SymptomParser

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ ეს არ არის დიაგნოზი. მედგზური არ ანაცვლებს ექიმის კონსულტაციას."


class SymptomPipeline:
    """Orchestrates the full symptom navigation pipeline."""

    def __init__(self):
        self.parser = SymptomParser()
        self.differential = DifferentialAnalysis()
        self.matcher = ResearchMatcher()
        self.report_gen = NavigatorReportGenerator()

    async def execute(self, inp: SymptomsInput) -> SearchResponse:
        logger.info("Pipeline B | symptoms=%s", inp.symptoms_text[:80])

        # B1: Parse symptoms
        try:
            parsed = await self.parser.parse(inp)
        except Exception as e:
            logger.error("Pipeline B | B1 failed | %s", str(e)[:200])
            return SearchResponse(
                meta="სიმპტომების ანალიზი ვერ მოხერხდა.", items=[], disclaimer=DISCLAIMER,
            )

        # Check for red flags
        if parsed.red_flags:
            logger.warning("Pipeline B | RED FLAGS detected: %s", parsed.red_flags)

        # B2: Differential analysis
        try:
            diff_result = await self.differential.analyze(parsed)
        except Exception as e:
            logger.error("Pipeline B | B2 failed | %s", str(e)[:200])
            diff_result = {"research_directions": [], "disclaimer": "ანალიზი ვერ მოხერხდა."}

        # B3: Research matcher (uses B2's research directions)
        try:
            matched = await self.matcher.match(
                directions=diff_result.get("research_directions", []),
                patient_age=inp.age,
                patient_sex=inp.sex,
            )
        except Exception as e:
            logger.warning("Pipeline B | B3 failed | %s", str(e)[:200])
            matched = {}

        # B4: Generate report
        try:
            report = await self.report_gen.generate(
                parsed=parsed,
                differential=diff_result,
                matched_research=matched,
                original_symptoms=inp.symptoms_text,
            )
            logger.info("Pipeline B complete | items=%d", len(report.items))
            return report
        except Exception as e:
            logger.error("Pipeline B | B4 failed | %s", str(e)[:200])
            return SearchResponse(
                meta="ანგარიშის გენერაცია ვერ მოხერხდა.", items=[], disclaimer=DISCLAIMER,
            )
