"""B4 — Navigator Report Generator.

Uses Claude Opus to produce a patient-facing Georgian symptom navigation report.
"""

import json
import logging

from app.orchestrator.schemas import (
    ParsedSymptoms,
    ResultItem,
    SearchResponse,
    TipItem,
)
from app.services.llm_client import call_opus_json, call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)

DISCLAIMER = "⚕️ ეს არ არის დიაგნოზი. მედგზური არ ანაცვლებს ექიმის კონსულტაციას. წარმოდგენილი ინფორმაცია განკუთვნილია საინფორმაციო მიზნებისთვის."


class NavigatorReportGenerator:
    """B4 agent — generate patient-facing symptom navigation report."""

    async def generate(
        self,
        parsed: ParsedSymptoms,
        differential: dict,
        matched_research: dict[str, list[dict]],
        original_symptoms: str,
    ) -> SearchResponse:
        """Generate the final symptom navigation report."""
        system_prompt = load_prompt("navigator_report")

        report_data = {
            "original_symptoms": original_symptoms,
            "parsed_symptoms": [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in parsed.extracted_symptoms
            ],
            "patient_context": parsed.patient_context,
            "medication_side_effects": parsed.possible_medication_side_effects,
            "red_flags": parsed.red_flags,
            "research_directions": differential.get("research_directions", []),
            "medication_interaction_note": differential.get("medication_interaction_note", ""),
            "recommended_specialists": differential.get("recommended_specialists", []),
            "recommended_tests": differential.get("recommended_tests", []),
            "matched_research": {
                k: [{"id": r.get("id", ""), "type": r.get("type", ""), "score": r.get("score", 0),
                     "title": r.get("data", {}).get("title", "")}
                    for r in v[:3]]
                for k, v in matched_research.items()
            },
        }
        user_message = json.dumps(report_data, indent=2, ensure_ascii=False)

        try:
            result = await call_opus_json(system_prompt, user_message, max_tokens=4000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("B4 Opus failed, trying Sonnet | %s", str(e)[:200])

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and result.get("items"):
                return self._parse_response(result)
        except Exception as e:
            logger.warning("B4 Sonnet also failed | %s", str(e)[:200])

        return self._build_fallback(parsed, differential, original_symptoms)

    def _parse_response(self, result: dict) -> SearchResponse:
        items = [
            ResultItem(
                title=i.get("title", ""),
                source=i.get("source", ""),
                body=i.get("body", ""),
                tags=i.get("tags", []),
                url=i.get("url", ""),
            )
            for i in result.get("items", [])
        ]
        tips = [TipItem(text=t["text"], icon=t.get("icon", "")) for t in result.get("tips", [])]
        next_steps = [TipItem(text=t["text"], icon=t.get("icon", "")) for t in result.get("nextSteps", [])]

        return SearchResponse(
            meta=result.get("meta", "სიმპტომების ანალიზი"),
            items=items, tips=tips, nextSteps=next_steps,
            disclaimer=result.get("disclaimer", DISCLAIMER),
        )

    def _build_fallback(
        self, parsed: ParsedSymptoms, differential: dict, symptoms: str,
    ) -> SearchResponse:
        items = []

        # Symptom summary
        symptom_names = [
            s.get("ka", "") if isinstance(s, dict) else s.ka
            for s in parsed.extracted_symptoms
        ]
        items.append(ResultItem(
            title="სიმპტომების შეჯამება",
            body=f"აღწერილი სიმპტომები: {', '.join(symptom_names)}",
            tags=["შეჯამება"],
        ))

        # Research directions
        for d in differential.get("research_directions", [])[:5]:
            items.append(ResultItem(
                title=d.get("condition_ka", d.get("condition", "")),
                body=d.get("relevance_explanation", ""),
                tags=[d.get("confidence", "possible")],
            ))

        # Specialists
        specialists = differential.get("recommended_specialists", [])
        if specialists:
            items.append(ResultItem(
                title="რეკომენდებული სპეციალისტები",
                body="- " + "\n- ".join(specialists),
                tags=["სპეციალისტი"],
            ))

        return SearchResponse(
            meta="სიმპტომების ანალიზი",
            items=items, disclaimer=DISCLAIMER,
        )
