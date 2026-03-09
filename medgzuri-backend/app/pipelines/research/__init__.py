"""Pipeline A — Research Search.

Flow: A1 (Term Normalizer) → [A2 (Clinical Trials) || A3 (Literature+Cochrane)] → A4 (Aggregator)
      → Evidence Grading → Optional Multi-hop → A5 (Report)
"""

import asyncio
import logging

from app.orchestrator.schemas import ResearchInput, ResultItem, SearchResponse
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.report_generator import ResearchReportGenerator
from app.pipelines.research.term_normalizer import TermNormalizer
from app.services.evidence_grader import grade_evidence, EVIDENCE_MARKERS, EVIDENCE_LABELS

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

        # A2 + A3: Route based on researchType (study_type field)
        research_type = inp.study_type  # "clinical_trial" | "research_results" | "all"
        logger.info("Pipeline A | research_type=%s", research_type)

        trials = []
        literature: dict = {"articles": []}

        if research_type == "clinical_trial":
            # Only ClinicalTrials.gov — active/recruiting trials
            try:
                trials = await self.trials_agent.search(
                    terms=terms,
                    age_group=inp.age_group,
                    geography=inp.geography,
                    status="recruiting",
                )
            except Exception as e:
                logger.warning("Pipeline A | A2 failed | %s", str(e)[:200])

        elif research_type == "research_results":
            # A2: completed trials with results + A3: PubMed
            trials_task = self.trials_agent.search(
                terms=terms,
                age_group=inp.age_group,
                geography=inp.geography,
                status="completed",
                results_posted=True,
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

        else:
            # Default "all" — both A2 and A3
            trials_task = self.trials_agent.search(
                terms=terms,
                age_group=inp.age_group,
                geography=inp.geography,
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

        # Diagnostic logging — track trial/article counts through pipeline
        articles_count = len(literature.get("articles", []))
        logger.info(
            "Pipeline A | A2 trials=%d | A3 articles=%d",
            len(trials), articles_count,
        )

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

        scored_trials = sum(1 for r in scored if r.get("type") == "trial")
        scored_articles = sum(1 for r in scored if r.get("type") == "article")
        logger.info(
            "Pipeline A | A4 scored=%d | trials=%d | articles=%d",
            len(scored), scored_trials, scored_articles,
        )

        # A5 disabled — Opus 120s + Sonnet 91s = 211s timeout, too slow.
        # Use _build_response + batch translate directly.
        report = await self._build_response(scored, inp.diagnosis, research_type)
        logger.info("Pipeline A complete (fallback) | items=%d", len(report.items))
        return report

    async def _build_response(self, scored: list[dict], query: str, research_type: str = "clinical_trial") -> SearchResponse:
        """Build SearchResponse directly from scored results with full formatting."""
        trial_count = sum(1 for r in scored if r.get("type") == "trial")
        article_count = sum(1 for r in scored if r.get("type") == "article")
        logger.info(
            "_build_response | scored=%d | trials=%d | articles=%d",
            len(scored), trial_count, article_count,
        )

        items = []
        trial_meta = []  # metadata per trial for body building

        for r in scored[:3]:
            data = r.get("data", {})
            if r.get("type") == "trial":
                logger.info(
                    "Building trial item | nct=%s | title=%s",
                    data.get("nct_id", "?"), data.get("title", "")[:50],
                )
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
                # Add evidence level tag if available
                evidence_level = data.get("evidence_level", "")
                evidence_marker = data.get("evidence_marker", "") or EVIDENCE_MARKERS.get(evidence_level, "")
                evidence_label = data.get("evidence_label", "") or EVIDENCE_LABELS.get(evidence_level, "")

                article_tags = ["სტატია", str(data.get("year", ""))]
                if evidence_level:
                    article_tags.insert(0, f"{evidence_marker} დონე {evidence_level}")

                items.append(ResultItem(
                    title=data.get("title", ""),
                    source=data.get("journal", ""),
                    body=data.get("abstract_summary", data.get("abstract", ""))[:200],
                    tags=article_tags,
                    url=data.get("source_url", ""),
                    evidence_level=evidence_level,
                    evidence_label=evidence_label,
                ))

        # Translate tags using static dict
        for item in items:
            item.tags = [TAG_TRANSLATIONS.get(t, t) for t in item.tags]

        # Single LLM call: translate titles + generate rich body
        try:
            await self._batch_translate_and_explain(items, trial_meta, research_type)
            logger.info("Batch translate+explain complete | items=%d", len(items))
        except Exception as e:
            logger.warning("Batch translate/explain failed, using raw data | %s", str(e)[:200])
            # Fallback: build trial bodies from metadata without LLM
            for meta in trial_meta:
                url = f"https://clinicaltrials.gov/study/{meta['nct_id']}"
                items[meta["item_index"]].body = (
                    f"📋 ფაზა: {meta['phase_ka']} | სტატუსი: {meta['status_ka']}\n"
                    f"💊 ინტერვენცია: {meta['intervention']}\n"
                    f"👤 ასაკი: {meta['age']}, {meta['sex_ka']}\n"
                    f"📍 ლოკაცია: {meta['location']}\n"
                    f"🏢 სპონსორი: {meta['sponsor']}\n"
                    f"💰 ღირებულება: {meta['cost']}\n"
                    f"📧 კონტაქტი: {meta['contact']}\n"
                    f"📎 ლინკი: {url}"
                )

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} შედეგი: {query}",
            items=items,
            disclaimer=DISCLAIMER,
        )

    async def _batch_translate_and_explain(
        self, items: list[ResultItem], trial_meta: list[dict],
        research_type: str = "clinical_trial",
    ) -> None:
        """Single LLM call: translate titles and generate rich Georgian body for all items."""
        import json as _json
        from app.services.llm_client import call_sonnet_json

        # Build numbered task list for LLM
        llm_items = []
        task_map = []  # (item_index, type, meta_or_none)

        for i, item in enumerate(items):
            meta = next((m for m in trial_meta if m["item_index"] == i), None)
            if meta:
                llm_items.append({
                    "id": len(llm_items) + 1,
                    "type": "trial",
                    "title": meta["title_en"],
                    "intervention": meta["intervention"],
                    "phase": meta["phase_ka"],
                    "status": meta["status_ka"],
                    "nct_id": meta["nct_id"],
                    "age": meta["age"],
                    "sex": meta["sex_ka"],
                    "location": meta["location"],
                    "sponsor": meta["sponsor"],
                    "cost": meta["cost"],
                    "contact": meta["contact"],
                })
                task_map.append((i, "trial", meta))
            else:
                llm_items.append({
                    "id": len(llm_items) + 1,
                    "type": "article",
                    "title": item.title,
                    "body": item.body,
                    "url": item.url or "",
                })
                task_map.append((i, "article", None))

        if not llm_items:
            return

        if research_type == "research_results":
            trial_instructions = (
                "   დასრულებული კვლევისთვის დაწერე 4-6 აბზაცი:\n"
                "   • რა იკვლიეს — კვლევის მიზანი მარტივი ენით\n"
                "   • როგორ იკვლიეს — მეთოდი, პაციენტების რაოდენობა\n"
                "   • რა გამოვიდა — შედეგები, ციფრებით თუ შესაძლებელია\n"
                "   • დასკვნა — რა ნიშნავს ეს პაციენტისთვის\n"
                "   • 📎 ლინკი: https://clinicaltrials.gov/study/{nct_id}\n"
            )
        else:
            trial_instructions = (
                "   მიმდინარე კვლევისთვის დაწერე 4-6 აბზაცი:\n"
                "   • 🔬 კვლევის მიზანი — რას ამოწმებენ, გასაგებ ენაზე\n"
                "   • 📋 ფაზა, სტატუსი, NCT ნომერი\n"
                "   • 💊 რას იკვლევენ — ინტერვენცია, წამალი, მეთოდი\n"
                "   • 👤 ვინ შეიძლება მონაწილეობდეს — ასაკი, სქესი, კრიტერიუმები\n"
                "   • 📍 სად მიმდინარეობს — ქვეყანა, კლინიკა, კონტაქტი\n"
                "   • 💰 ღირებულება, სპონსორი\n"
                "   • 📎 ლინკი: https://clinicaltrials.gov/study/{nct_id}\n"
            )

        system = (
            "შენ ხარ სამედიცინო მთარგმნელი. დააბრუნე JSON.\n"
            "ყველა ტექსტი: გასაგებ, ადამიანურ ქართულ ენაზე. "
            "არა სამედიცინო ჟარგონით. მარტივი სიტყვები.\n\n"
            "თითოეული item-ისთვის:\n"
            "1. თარგმნე სათაური (title_ka) ქართულად\n"
            "2. თუ type არის \"trial\":\n"
            f"{trial_instructions}"
            "3. თუ type არის \"article\":\n"
            "   დაწერე 4-6 აბზაცი ქართულად:\n"
            "   • რა იკვლიეს — მიზანი მარტივი ენით\n"
            "   • როგორ იკვლიეს — მეთოდი, პაციენტების რაოდენობა\n"
            "   • რა გამოვიდა — შედეგები, ციფრებით\n"
            "   • დასკვნა — რა ნიშნავს ეს პაციენტისთვის\n"
            "   • 📎 ლინკი: {url}\n\n"
            "პასუხის ფორმატი (მხოლოდ JSON):\n"
            '{"results": [\n'
            '  {"id": 1, "title_ka": "...", "body_ka": "..."},\n'
            '  {"id": 2, "title_ka": "...", "body_ka": "..."}\n'
            "]}\n"
            "body_ka — ვრცელი აღწერა ყველა ტიპისთვის (trial და article)."
        )

        user_msg = _json.dumps({"items": llm_items}, ensure_ascii=False, indent=2)
        result = await call_sonnet_json(system, user_msg, max_tokens=8000)

        if not result or "results" not in result:
            raise ValueError("LLM returned no results for batch translate")

        results_by_id = {r["id"]: r for r in result["results"]}

        for task_idx, (item_idx, item_type, meta) in enumerate(task_map):
            r = results_by_id.get(task_idx + 1, {})

            if r.get("title_ka"):
                items[item_idx].title = r["title_ka"]

            if r.get("body_ka"):
                items[item_idx].body = r["body_ka"]
            elif item_type == "trial" and meta:
                # Fallback if LLM didn't return body for this trial
                url = f"https://clinicaltrials.gov/study/{meta['nct_id']}"
                items[item_idx].body = (
                    f"📋 ფაზა: {meta['phase_ka']} | სტატუსი: {meta['status_ka']}\n"
                    f"💊 ინტერვენცია: {meta['intervention']}\n"
                    f"👤 ასაკი: {meta['age']}, {meta['sex_ka']}\n"
                    f"📍 ლოკაცია: {meta['location']}\n"
                    f"🏢 სპონსორი: {meta['sponsor']}\n"
                    f"💰 ღირებულება: {meta['cost']}\n"
                    f"📧 კონტაქტი: {meta['contact']}\n"
                    f"📎 ლინკი: {url}"
                )
