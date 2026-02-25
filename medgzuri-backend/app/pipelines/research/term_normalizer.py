"""A1 — Term Normalizer.

Translates Georgian medical terms → English, generates MeSH terms,
ICD-10 codes, and optimized search queries for ClinicalTrials.gov / PubMed.
"""

import logging

from app.orchestrator.schemas import NormalizedTerms, ResearchInput
from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)


class TermNormalizer:
    """A1 agent — normalize medical terminology for search."""

    async def normalize(self, inp: ResearchInput) -> NormalizedTerms:
        """Convert diagnosis text into structured search terms."""
        system_prompt = load_prompt("term_normalizer")

        user_message = (
            f"Query: {inp.diagnosis}\n"
            f"Age group: {inp.age_group}\n"
            f"Study type: {inp.study_type}\n"
            f"Context: {inp.additional_context}\n"
            f"Geography: {inp.geography}"
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=1500)
            if result:
                logger.info("A1 normalized | primary=%s", result.get("english_primary", ""))
                return NormalizedTerms(
                    original_query=inp.diagnosis,
                    english_primary=result.get("english_primary", inp.diagnosis),
                    english_terms=result.get("english_terms", []),
                    mesh_terms=result.get("mesh_terms", []),
                    icd10=result.get("icd10", ""),
                    synonyms=result.get("synonyms", []),
                    search_queries=result.get("search_queries", {}),
                )
        except Exception as e:
            logger.warning("A1 LLM failed, using fallback | %s", str(e)[:200])

        # Fallback — use raw diagnosis as search term
        return NormalizedTerms(
            original_query=inp.diagnosis,
            english_primary=inp.diagnosis,
            english_terms=[inp.diagnosis],
            search_queries={
                "clinicaltrials": inp.diagnosis,
                "pubmed": inp.diagnosis,
            },
        )
