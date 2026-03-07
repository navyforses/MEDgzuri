"""Pipeline A — Research Search.

Flow: A1 (Term Normalizer) → [A2 (Clinical Trials) || A3 (Literature)] → A4 (Aggregator) → A5 (Report)
"""

import asyncio
import logging

from app.orchestrator.schemas import ResearchInput, ResultItem, SearchResponse
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.report_generator import ResearchReportGenerator
from app.pipelines.research.term_normalizer import TermNormalizer
from app.services.translation import translation_service

logger = logging.getLogger(__name__)

# EN → KA static translations for trial phase/status tags
TAG_TRANSLATIONS = {
    "Recruiting": "მიმდინარეობს მიღება",
    "RECRUITING": "მიმდინარეობს მიღება",
    "Not yet recruiting": "მიღება ჯერ არ დაწყებულა",
    "NOT_YET_RECRUITING": "მიღება ჯერ არ დაწყებულა",
    "Active, not recruiting": "აქტიური, მიღება დასრულებულია",
    "ACTIVE_NOT_RECRUITING": "აქტიური, მიღება დასრულებულია",
    "Completed": "დასრულებული",
    "COMPLETED": "დასრულებული",
    "Terminated": "შეწყვეტილი",
    "TERMINATED": "შეწყვეტილი",
    "Withdrawn": "გაუქმებული",
    "WITHDRAWN": "გაუქმებული",
    "Suspended": "შეჩერებული",
    "SUSPENDED": "შეჩერებული",
    "Phase 1": "ფაზა 1",
    "Phase 2": "ფაზა 2",
    "Phase 3": "ფაზა 3",
    "Phase 4": "ფაზა 4",
    "PHASE1": "ფაზა 1",
    "PHASE2": "ფაზა 2",
    "PHASE3": "ფაზა 3",
    "PHASE4": "ფაზა 4",
    "Phase 1/Phase 2": "ფაზა 1/ფაზა 2",
    "Phase 2/Phase 3": "ფაზა 2/ფაზა 3",
    "Early Phase 1": "ადრეული ფაზა 1",
    "Not Applicable": "არ ეხება",
    "NA": "არ ეხება",
}

DISCLAIMER = "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."


class ResearchPipeline:
    """Orchestrates the full research search pipeline."""

    def __init__(self):
        self.normalizer = TermNormalizer()
        self.trials_agent = ClinicalTrialsAgent()
        self.literature_agent = LiteratureSearchAgent()
        self.aggregator = ResearchAggregator()
        self.report_generator = ResearchReportGenerator()

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

        # A5: LLM report generation (Opus → Sonnet) — returns Georgian directly
        report = None
        try:
            report = await self.report_generator.generate(
                scored_results=scored,
                literature=literature,
                original_query=inp.diagnosis,
            )
        except Exception as e:
            logger.warning("Pipeline A | A5 failed | %s", str(e)[:200])

        if report and report.items:
            # Apply tag translations to LLM output (may still have English tags)
            for item in report.items:
                item.tags = [TAG_TRANSLATIONS.get(t, t) for t in item.tags]
            logger.info("Pipeline A complete (A5 LLM) | items=%d", len(report.items))
            return report

        # Fallback: build directly from scored results + batch translate
        logger.info("Pipeline A | A5 returned no items, using fallback with batch translation")
        report = await self._build_response(scored, inp.diagnosis)
        logger.info("Pipeline A complete (fallback) | items=%d", len(report.items))
        return report

    async def _build_response(self, scored: list[dict], query: str) -> SearchResponse:
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

        # Translate tags using static dict
        for item in items:
            item.tags = [TAG_TRANSLATIONS.get(t, t) for t in item.tags]

        # Batch translate titles and bodies EN → KA (single LLM call)
        texts_to_translate = []
        for item in items:
            texts_to_translate.append(item.title)
            texts_to_translate.append(item.body)

        try:
            translated = await translation_service.batch_translate(
                texts_to_translate, source="en", target="ka",
            )
            for i, item in enumerate(items):
                item.title = translated[i * 2] or item.title
                item.body = translated[i * 2 + 1] or item.body
            logger.info("Translation complete | texts=%d", len(texts_to_translate))
        except Exception as e:
            logger.warning("Batch translation failed, returning English | %s", str(e)[:200])

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} შედეგი: {query}",
            items=items,
            disclaimer=DISCLAIMER,
        )
