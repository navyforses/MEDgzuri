"""B2 — Differential Analysis Agent.

Uses Claude Sonnet for medical reasoning to identify research directions.
Falls back to static response if unavailable.
CRITICAL: This agent does NOT diagnose — it suggests research directions only.
"""

import json
import logging

from app.orchestrator.schemas import ParsedSymptoms, ResearchDirection
from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)


class DifferentialAnalysis:
    """B2 agent — identify research directions from symptoms (NOT diagnosis)."""

    async def analyze(self, parsed: ParsedSymptoms) -> dict:
        """Analyze symptoms and return research directions.

        Returns: {
            "research_directions": [...],
            "medication_interaction_note": "...",
            "recommended_specialists": [...],
            "recommended_tests": [...],
            "disclaimer": "..."
        }
        """
        system_prompt = load_prompt("differential_analysis")

        # Build user message from parsed symptoms
        symptoms_list = [
            f"- {s.get('ka', '')} ({s.get('en', '')})" if isinstance(s, dict)
            else f"- {s.ka} ({s.en})"
            for s in parsed.extracted_symptoms
        ]
        context = parsed.patient_context or {}

        user_message = (
            f"Extracted symptoms:\n" + "\n".join(symptoms_list) + "\n\n"
            f"Patient context:\n"
            f"- Age: {context.get('age', 'unknown')}\n"
            f"- Sex: {context.get('sex', 'unknown')}\n"
            f"- Comorbidities: {', '.join(context.get('comorbidities', [])) or 'none'}\n"
            f"- Medications: {', '.join(context.get('medications', [])) or 'none'}\n\n"
            f"Side effects identified:\n"
            + json.dumps(parsed.possible_medication_side_effects, ensure_ascii=False)
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and result.get("research_directions"):
                logger.info("B2 analyzed | directions=%d", len(result["research_directions"]))
                return result
        except Exception as e:
            logger.warning("B2 Sonnet failed | %s", str(e)[:200])

        # Final fallback
        return {
            "research_directions": [],
            "medication_interaction_note": "",
            "recommended_specialists": [],
            "recommended_tests": [],
            "disclaimer": "ეს არ არის დიაგნოზი — მხოლოდ საინფორმაციო მიმოხილვა",
        }
