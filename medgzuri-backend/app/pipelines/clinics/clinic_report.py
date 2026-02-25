"""C5 — Clinic Report Generator.

Uses Claude Opus to produce a structured Georgian clinic comparison report.
"""

import json
import logging

from app.orchestrator.schemas import (
    ClinicWithCost,
    ClinicWithRating,
    ComparisonTable,
    ResultItem,
    SearchResponse,
    TipItem,
)
from app.services.llm_client import call_opus_json, call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ ფასები საინფორმაციო ხასიათისაა და შეიძლება განსხვავდებოდეს. მედგზური არ ანაცვლებს ექიმის კონსულტაციას."


class ClinicReportGenerator:
    """C5 agent — generate ranked clinic report in Georgian."""

    async def generate(
        self,
        rated_clinics: list[ClinicWithRating],
        cost_data: list[ClinicWithCost],
        original_query: str,
    ) -> SearchResponse:
        """Generate the final clinic report using Claude Opus."""
        system_prompt = load_prompt("clinic_report")

        # Merge rating + cost data
        report_data = self._merge_data(rated_clinics, cost_data, original_query)
        user_message = json.dumps(report_data, indent=2, ensure_ascii=False)

        try:
            result = await call_opus_json(system_prompt, user_message, max_tokens=4000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("C5 Opus failed, trying Sonnet | %s", str(e)[:200])

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("C5 Sonnet also failed | %s", str(e)[:200])

        # Fallback
        return self._build_fallback(rated_clinics, cost_data, original_query)

    def _merge_data(
        self, rated: list[ClinicWithRating],
        costs: list[ClinicWithCost], query: str,
    ) -> dict:
        cost_map = {c.clinic_name: c.model_dump() for c in costs}
        clinics = []
        for r in rated:
            clinic_data = r.model_dump()
            clinic_data["cost_info"] = cost_map.get(r.name, {})
            clinics.append(clinic_data)
        return {"query": query, "clinics": clinics}

    def _parse_response(self, result: dict) -> SearchResponse:
        items = [
            ResultItem(
                title=i.get("title", ""),
                source=i.get("source", ""),
                body=i.get("body", ""),
                tags=i.get("tags", []),
                url=i.get("url", ""),
                rating=i.get("rating"),
                price=i.get("price", ""),
            )
            for i in result.get("items", [])
        ]
        comparison = None
        if result.get("comparison"):
            c = result["comparison"]
            comparison = ComparisonTable(
                headers=c.get("headers", []),
                rows=c.get("rows", []),
            )
        tips = [TipItem(text=t["text"], icon=t.get("icon", "")) for t in result.get("tips", [])]
        next_steps = [TipItem(text=t["text"], icon=t.get("icon", "")) for t in result.get("nextSteps", [])]

        return SearchResponse(
            meta=result.get("meta", "კლინიკების ძიების შედეგები"),
            items=items, comparison=comparison,
            tips=tips, nextSteps=next_steps,
            disclaimer=result.get("disclaimer", DISCLAIMER),
        )

    def _build_fallback(
        self, rated: list[ClinicWithRating],
        costs: list[ClinicWithCost], query: str,
    ) -> SearchResponse:
        cost_map = {c.clinic_name: c for c in costs}
        items = []
        rows = []

        for clinic in rated[:10]:
            cost = cost_map.get(clinic.name)
            visa_text = "არა" if cost and not cost.visa_required else "კი"
            flight = cost.estimated_flight_cost if cost else "N/A"

            items.append(ResultItem(
                title=clinic.name,
                source=f"{clinic.country}, {clinic.city}",
                body=(
                    f"**აქტიური კვლევები:** {clinic.active_trials_count}\n"
                    f"**რეიტინგი:** {clinic.rating_score:.0f}/100\n"
                    f"**JCI:** {'დიახ' if clinic.jci_accredited else 'ინფორმაცია არ არის'}\n"
                    f"**ვიზა:** {visa_text}\n"
                    f"**ავიაბილეთი:** {flight}"
                ),
                tags=[clinic.country, f"კვლევები: {clinic.active_trials_count}"],
                url=clinic.source_url,
                rating=clinic.rating_score,
            ))
            rows.append([
                clinic.name, clinic.country, str(clinic.active_trials_count),
                f"{clinic.rating_score:.0f}", visa_text,
            ])

        comparison = ComparisonTable(
            headers=["კლინიკა", "ქვეყანა", "კვლევები", "ქულა", "ვიზა"],
            rows=rows,
        ) if rows else None

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} კლინიკა: {query}",
            items=items, comparison=comparison,
            disclaimer=DISCLAIMER,
        )
