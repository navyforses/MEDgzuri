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
        """Build SearchResponse directly from scored results with full formatting."""
        items = []
        trial_meta = []  # metadata per trial for body building

        for r in scored[:10]:
            data = r.get("data", {})
            if r.get("type") == "trial":
                nct_id = data.get("nct_id", "")
                phase = data.get("phase", "")
                status = data.get("status", "")
                sponsor = data.get("sponsor", "")

                # Interventions
                interventions = data.get("interventions", [])
                intervention_names = ", ".join(
                    i.get("name", "") for i in interventions if i.get("name")
                ) or "მიუთითებელი"

                # Eligibility
                elig = data.get("eligibility", {})
                min_age = elig.get("min_age", "N/A")
                max_age = elig.get("max_age", "N/A")
                sex = elig.get("sex", "All")
                sex_ka = {"All": "ორივე სქესი", "Male": "მამრობითი", "Female": "მდედრობითი"}.get(sex, sex)
                age_str = f"{min_age}–{max_age}" if min_age != "N/A" else "მიუთითებელი"

                # Locations
                loc_parts = []
                for loc in data.get("locations", [])[:3]:
                    parts = [p for p in [loc.get("country"), loc.get("city")] if p]
                    facility = loc.get("facility", "")
                    loc_parts.append(f"{', '.join(parts)} — {facility}" if facility else ", ".join(parts))
                location_str = "; ".join(loc_parts) if loc_parts else "მიუთითებელი"

                # Contact email
                contact_email = ""
                for loc in data.get("locations", []):
                    email = loc.get("contact_email", "")
                    if email:
                        contact_email = email
                        break

                # Cost estimation based on sponsor type
                sponsor_lower = sponsor.lower()
                is_likely_free = any(kw in sponsor_lower for kw in [
                    "pharma", "pfizer", "novartis", "roche", "merck", "lilly",
                    "astrazeneca", "sanofi", "bayer", "johnson", "bristol",
                    "abbvie", "amgen", "genentech", "gilead", "regeneron",
                    "moderna", "biogen", "university", "université", "universität",
                    "institute", "hospital", "nih", "national", "foundation",
                ])
                cost = "ჩვეულებრივ უფასო" if is_likely_free else "გასარკვევი კლინიკასთან"

                phase_ka = TAG_TRANSLATIONS.get(phase, phase)
                status_ka = TAG_TRANSLATIONS.get(status, status)

                items.append(ResultItem(
                    title=data.get("title", ""),
                    source=f"ClinicalTrials.gov | {nct_id}",
                    body="",  # built after LLM call
                    tags=[phase, status],
                    url=data.get("url", ""),
                    phase=phase,
                ))
                trial_meta.append({
                    "item_index": len(items) - 1,
                    "title_en": data.get("title", ""),
                    "intervention": intervention_names,
                    "nct_id": nct_id,
                    "phase_ka": phase_ka,
                    "status_ka": status_ka,
                    "age": age_str,
                    "sex_ka": sex_ka,
                    "location": location_str,
                    "sponsor": sponsor,
                    "cost": cost,
                    "contact": contact_email or "მიუთითებელი",
                })
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

        # Single LLM call: translate titles + explain trials + translate article bodies
        try:
            await self._batch_translate_and_explain(items, trial_meta)
            logger.info("Batch translate+explain complete | items=%d", len(items))
        except Exception as e:
            logger.warning("Batch translate/explain failed, using raw data | %s", str(e)[:200])
            # Fallback: build trial bodies from metadata without LLM explanation
            for meta in trial_meta:
                items[meta["item_index"]].body = (
                    f"📋 ფაზა: {meta['phase_ka']} | სტატუსი: {meta['status_ka']}\n"
                    f"💊 ინტერვენცია: {meta['intervention']}\n"
                    f"👤 ასაკი: {meta['age']}, {meta['sex_ka']}\n"
                    f"📍 ლოკაცია: {meta['location']}\n"
                    f"🏢 სპონსორი: {meta['sponsor']}\n"
                    f"💰 ღირებულება: {meta['cost']}\n"
                    f"📧 კონტაქტი: {meta['contact']}"
                )

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} შედეგი: {query}",
            items=items,
            disclaimer=DISCLAIMER,
        )

    async def _batch_translate_and_explain(
        self, items: list[ResultItem], trial_meta: list[dict],
    ) -> None:
        """Single LLM call: translate all titles, explain trials, translate article bodies."""
        import json as _json
        from app.services.llm_client import call_sonnet_json

        # Build numbered task list for LLM
        llm_items = []
        task_map = []  # (item_index, type, meta_or_none)

        for i, item in enumerate(items):
            # Find if this is a trial with metadata
            meta = next((m for m in trial_meta if m["item_index"] == i), None)
            if meta:
                llm_items.append({
                    "id": len(llm_items) + 1,
                    "type": "trial",
                    "title": meta["title_en"],
                    "intervention": meta["intervention"],
                })
                task_map.append((i, "trial", meta))
            else:
                llm_items.append({
                    "id": len(llm_items) + 1,
                    "type": "article",
                    "title": item.title,
                    "body": item.body,
                })
                task_map.append((i, "article", None))

        if not llm_items:
            return

        system = (
            "შენ ხარ სამედიცინო მთარგმნელი. დააბრუნე JSON.\n\n"
            "თითოეული item-ისთვის:\n"
            "1. თარგმნე სათაური (title) ქართულად\n"
            "2. თუ type არის \"trial\":\n"
            "   დაწერე 1-2 წინადადებით რა არის კვლევის მიზანი, ისე რომ "
            "სამედიცინო განათლების არმქონე ადამიანმა გაიგოს.\n"
            "   გამოიყენე მარტივი სიტყვები, არა სამედიცინო ტერმინები.\n"
            "   მაგალითად: 'ეს კვლევა ამოწმებს ახალ წამალს, რომელიც ეხმარება "
            "ორგანიზმს სიმსივნის უჯრედების წინააღმდეგ ბრძოლაში.'\n"
            "3. თუ type არის \"article\": თარგმნე body ქართულად. "
            "რელევანტურობის აღწერა მარტივი ენით.\n\n"
            "პასუხის ფორმატი (მხოლოდ JSON):\n"
            '{"results": [\n'
            '  {"id": 1, "title_ka": "...", "explain_ka": "..."},\n'
            '  {"id": 2, "title_ka": "...", "body_ka": "..."}\n'
            "]}\n"
            "explain_ka — მხოლოდ trial-ებისთვის.\n"
            "body_ka — მხოლოდ article-ებისთვის."
        )

        user_msg = _json.dumps({"items": llm_items}, ensure_ascii=False, indent=2)
        result = await call_sonnet_json(system, user_msg, max_tokens=4096)

        if not result or "results" not in result:
            raise ValueError("LLM returned no results for batch translate")

        results_by_id = {r["id"]: r for r in result["results"]}

        for task_idx, (item_idx, item_type, meta) in enumerate(task_map):
            r = results_by_id.get(task_idx + 1, {})

            # Translated title
            if r.get("title_ka"):
                items[item_idx].title = r["title_ka"]

            if item_type == "trial" and meta:
                explain = r.get("explain_ka", "")
                explain_line = f"🔬 {explain}\n" if explain else ""
                items[item_idx].body = (
                    f"{explain_line}"
                    f"📋 ფაზა: {meta['phase_ka']} | სტატუსი: {meta['status_ka']}\n"
                    f"💊 ინტერვენცია: {meta['intervention']}\n"
                    f"👤 ასაკი: {meta['age']}, {meta['sex_ka']}\n"
                    f"📍 ლოკაცია: {meta['location']}\n"
                    f"🏢 სპონსორი: {meta['sponsor']}\n"
                    f"💰 ღირებულება: {meta['cost']}\n"
                    f"📧 კონტაქტი: {meta['contact']}"
                )
            elif item_type == "article":
                if r.get("body_ka"):
                    items[item_idx].body = r["body_ka"]
