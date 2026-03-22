"""C5 — Clinic Report Generator.

Uses Claude Opus to produce a structured Georgian clinic comparison report.
"""

import json
import logging
from typing import Any

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
            result = await call_opus_json(system_prompt, user_message, max_tokens=8000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("C5 Opus failed, trying Sonnet | %s", str(e)[:200])

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=8000)
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
        from app.data.clinics_database import ALL_CLINICS

        # Build lookup for database clinic data
        db_lookup: dict[str, Any] = {}
        for c in ALL_CLINICS:
            db_lookup[c.name_en.lower()] = c

        cost_map = {c.clinic_name: c for c in costs}
        items = []
        rows = []

        for clinic in rated[:10]:
            cost = cost_map.get(clinic.name)
            visa_text = "არა" if cost and not cost.visa_required else "კი"
            flight = cost.estimated_flight_cost if cost else "N/A"
            treatment_cost = cost.estimated_treatment_cost if cost else "N/A"
            total = cost.total_estimated_cost if cost else "N/A"

            # Check if this is a database clinic (recommended for Georgians)
            db_clinic = db_lookup.get(clinic.name.lower())
            recommended = db_clinic.recommended_for_georgians if db_clinic else False
            name_ka = db_clinic.name_ka if db_clinic else clinic.name
            website = db_clinic.website if db_clinic else clinic.source_url

            recommended_tag = "რეკომენდებული ქართველი პაციენტებისთვის" if recommended else ""

            body_parts = [
                f"**{name_ka}**" if name_ka != clinic.name else "",
                f"**სპეციალიზაცია:** {clinic.specialization}" if clinic.specialization else "",
                f"**მკურნალობის ფასი:** {treatment_cost}" if treatment_cost != "N/A" else "",
                f"**სრული ღირებულება (მგზავრობით):** {total}" if total not in ("N/A", "ინდივიდუალური") else "",
                f"**ავიაბილეთი:** {flight}" if flight != "N/A" else "",
                f"**რეიტინგი:** {clinic.rating_score:.0f}/100",
                f"**JCI:** {'დიახ ✓' if clinic.jci_accredited else 'ინფორმაცია არ არის'}",
                f"**ვიზა:** {visa_text}",
                f"**ენები:** {', '.join(clinic.languages)}" if clinic.languages else "",
                f"⭐ {recommended_tag}" if recommended_tag else "",
            ]
            body = "\n".join(p for p in body_parts if p)

            tags = [clinic.country]
            if recommended:
                tags.append("რეკომენდებული")
            if clinic.jci_accredited:
                tags.append("JCI")
            if clinic.active_trials_count > 0:
                tags.append(f"კვლევები: {clinic.active_trials_count}")

            items.append(ResultItem(
                title=clinic.name,
                source=f"{clinic.country}, {clinic.city}",
                body=body,
                tags=tags,
                url=website,
                rating=clinic.rating_score,
                price=total if total not in ("N/A", "ინდივიდუალური") else treatment_cost,
            ))
            rows.append([
                clinic.name, clinic.country, treatment_cost,
                total if total not in ("N/A", "ინდივიდუალური") else "—",
                f"{clinic.rating_score:.0f}", visa_text,
            ])

        comparison = ComparisonTable(
            headers=["კლინიკა", "ქვეყანა", "მკურნალობა", "სრული ღირებულება", "ქულა", "ვიზა"],
            rows=rows,
        ) if rows else None

        return SearchResponse(
            meta=f"ნაპოვნია {len(items)} კლინიკა: {query}",
            items=items, comparison=comparison,
            disclaimer=DISCLAIMER,
        )
