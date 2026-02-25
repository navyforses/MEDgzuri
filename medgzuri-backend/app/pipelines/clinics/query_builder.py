"""C1 — Query Builder.

Normalizes diagnosis/treatment terms and prepares search filters for clinics.
"""

import logging

from app.orchestrator.schemas import ClinicInput
from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)


class ClinicQueryBuilder:
    """C1 agent — normalize terms and build clinic search queries."""

    async def build(self, inp: ClinicInput) -> dict:
        """Build search queries for clinic finding.

        Returns: {
            "english_primary": "...",
            "treatment_terms": [...],
            "specialty": "...",
            "search_queries": {"clinicaltrials": "...", "general": "..."}
        }
        """
        system_prompt = load_prompt("clinic_query_builder")

        user_message = (
            f"Diagnosis/Treatment: {inp.diagnosis_or_treatment}\n"
            f"Preferred countries: {', '.join(inp.preferred_countries) or 'worldwide'}\n"
            f"Budget: {inp.budget_range}\n"
            f"Language: {inp.language_preference}\n"
            f"Requirements: {inp.additional_requirements}"
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=1000)
            if result and result.get("english_primary"):
                logger.info("C1 built | primary=%s", result.get("english_primary", ""))
                return result
        except Exception as e:
            logger.warning("C1 LLM failed, using fallback | %s", str(e)[:200])

        # Fallback
        return {
            "english_primary": inp.diagnosis_or_treatment,
            "treatment_terms": [inp.diagnosis_or_treatment],
            "specialty": "",
            "search_queries": {
                "clinicaltrials": inp.diagnosis_or_treatment,
                "general": inp.diagnosis_or_treatment,
            },
        }
