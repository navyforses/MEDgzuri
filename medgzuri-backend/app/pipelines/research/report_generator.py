"""A5 — Report Generator.

Uses Claude Opus to produce a structured Georgian-language research report.
"""

import json
import logging

from app.orchestrator.schemas import ResultItem, SearchResponse, TipItem
from app.services.llm_client import call_opus_json, call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას. წარმოდგენილი ინფორმაცია განკუთვნილია საინფორმაციო მიზნებისთვის."


class ResearchReportGenerator:
    """A5 agent — generate structured Georgian research report."""

    async def generate(
        self,
        scored_results: list[dict],
        literature: dict,
        original_query: str,
    ) -> SearchResponse:
        """Generate the final report using Claude Opus."""
        system_prompt = load_prompt("research_report")

        # Prepare data for LLM
        top_results = scored_results[:10]
        report_data = {
            "query": original_query,
            "total_trials": sum(1 for r in scored_results if r["type"] == "trial"),
            "total_articles": sum(1 for r in scored_results if r["type"] == "article"),
            "top_results": self._prepare_results(top_results),
            "field_summary": literature.get("field_summary", ""),
        }

        user_message = json.dumps(report_data, indent=2, ensure_ascii=False)

        try:
            result = await call_opus_json(system_prompt, user_message, max_tokens=4000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("A5 Opus failed, trying Sonnet | %s", str(e)[:200])

        # Fallback to Sonnet
        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("A5 Sonnet also failed | %s", str(e)[:200])

        # Final fallback — build from raw data
        return self._build_fallback(scored_results, original_query)

    def _prepare_results(self, results: list[dict]) -> list[dict]:
        """Prepare results for LLM — trim large fields."""
        prepared = []
        for r in results:
            item = {
                "id": r.get("id", ""),
                "type": r.get("type", ""),
                "score": r.get("score", 0),
                "accessibility_index": r.get("accessibility_index", 0),
            }
            data = r.get("data", {})
            if r["type"] == "trial":
                item.update({
                    "title": data.get("title", ""),
                    "phase": data.get("phase", ""),
                    "status": data.get("status", ""),
                    "sponsor": data.get("sponsor", ""),
                    "url": data.get("url", ""),
                    "locations": data.get("locations", [])[:5],
                    "interventions": data.get("interventions", [])[:3],
                    "eligibility": data.get("eligibility", {}),
                })
            else:
                item.update({
                    "title": data.get("title", ""),
                    "abstract_summary": data.get("abstract_summary", "")[:300],
                    "journal": data.get("journal", ""),
                    "year": data.get("year"),
                    "doi": data.get("doi", ""),
                    "relevance_note": data.get("relevance_note", ""),
                })
            prepared.append(item)
        return prepared

    def _parse_response(self, result: dict) -> SearchResponse:
        """Parse LLM JSON output into SearchResponse."""
        items = []
        for item_data in result.get("items", []):
            items.append(ResultItem(
                title=item_data.get("title", ""),
                source=item_data.get("source", ""),
                body=item_data.get("body", ""),
                tags=item_data.get("tags", []),
                url=item_data.get("url", ""),
                phase=item_data.get("phase", ""),
                priority=item_data.get("priority", ""),
            ))

        tips = [TipItem(text=t["text"], icon=t.get("icon", ""))
                for t in result.get("tips", [])]
        next_steps = [TipItem(text=t["text"], icon=t.get("icon", ""))
                      for t in result.get("nextSteps", [])]

        return SearchResponse(
            meta=result.get("meta", "კვლევების ძიების შედეგები"),
            items=items,
            tips=tips,
            nextSteps=next_steps,
            disclaimer=result.get("disclaimer", DISCLAIMER),
        )

    def _build_fallback(self, scored: list[dict], query: str) -> SearchResponse:
        """Build a response from raw scored data without LLM."""
        items = []
        for r in scored[:10]:
            data = r.get("data", {})
            if r["type"] == "trial":
                locations = ", ".join(
                    f"{l.get('country', '')} ({l.get('facility', '')})"
                    for l in data.get("locations", [])[:3]
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
