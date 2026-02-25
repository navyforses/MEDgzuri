"""B1 — Symptom Parser.

Extracts structured symptom data from free-text Georgian descriptions.
Translates to English medical terms, identifies medication side effects.
"""

import json
import logging

from app.orchestrator.schemas import ParsedSymptoms, SymptomsInput
from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)


class SymptomParser:
    """B1 agent — parse symptoms from free text."""

    async def parse(self, inp: SymptomsInput) -> ParsedSymptoms:
        """Extract structured symptoms from user input."""
        system_prompt = load_prompt("symptom_parser")

        user_message = (
            f"Symptom description: {inp.symptoms_text}\n"
            f"Age: {inp.age or 'not specified'}\n"
            f"Sex: {inp.sex or 'not specified'}\n"
            f"Existing diagnoses: {inp.existing_diagnoses or 'none'}\n"
            f"Current medications: {inp.current_medications or 'none'}"
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=2000)
            if result and result.get("extracted_symptoms"):
                logger.info("B1 parsed | symptoms=%d", len(result["extracted_symptoms"]))
                return ParsedSymptoms(
                    extracted_symptoms=[
                        {"ka": s.get("ka", ""), "en": s.get("en", ""),
                         "medical": s.get("medical", ""), "severity": s.get("severity", "unknown")}
                        for s in result["extracted_symptoms"]
                    ],
                    patient_context=result.get("patient_context", {}),
                    possible_medication_side_effects=result.get("possible_medication_side_effects", []),
                    red_flags=result.get("red_flags", []),
                )
        except Exception as e:
            logger.warning("B1 LLM failed | %s", str(e)[:200])

        # Fallback — minimal parsing
        return ParsedSymptoms(
            extracted_symptoms=[
                {"ka": inp.symptoms_text, "en": inp.symptoms_text, "medical": "", "severity": "unknown"}
            ],
            patient_context={
                "age": inp.age, "sex": inp.sex,
                "comorbidities": [inp.existing_diagnoses] if inp.existing_diagnoses else [],
                "medications": [inp.current_medications] if inp.current_medications else [],
            },
        )
