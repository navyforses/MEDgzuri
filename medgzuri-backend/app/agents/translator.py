"""Agent 3: Medical Translator — handles ALL Georgian ↔ English translation.

Uses the expanded 305-term medical dictionary PLUS Claude for unknown terms.
Maintains translation consistency within a session via a session cache.
"""

import logging
import re
from typing import Any

from app.services.llm_client import call_sonnet_json
from app.services.translation import translation_service
from app.utils.medical_terms import KA_TO_EN, MEDICATIONS_KA_TO_EN

logger = logging.getLogger(__name__)

# Reverse lookup: EN → KA
_EN_TO_KA = {v.lower(): k for k, v in KA_TO_EN.items()}
_EN_TO_KA.update({v.lower(): k for k, v in MEDICATIONS_KA_TO_EN.items()})

# Lazily-compiled regex patterns for terminology consistency
_TERMINOLOGY_PATTERNS: dict[str, re.Pattern] = {}


class TranslatorAgent:
    """Handles all translation with session-level consistency cache."""

    def __init__(self) -> None:
        # Session cache: remembers translations within one orchestration run
        self._session_cache_ka_en: dict[str, str] = {}
        self._session_cache_en_ka: dict[str, str] = {}

    async def translate_query(self, text_ka: str) -> str:
        """Translate a Georgian medical query to English.

        Args:
            text_ka: Georgian text (diagnosis, symptoms, etc.)

        Returns:
            English translation of the medical query.
        """
        if not text_ka or not text_ka.strip():
            return ""

        text_ka = text_ka.strip()

        # Check session cache
        if text_ka in self._session_cache_ka_en:
            return self._session_cache_ka_en[text_ka]

        # Check static dictionary (exact match)
        dict_result = KA_TO_EN.get(text_ka) or MEDICATIONS_KA_TO_EN.get(text_ka)
        if dict_result:
            self._session_cache_ka_en[text_ka] = dict_result
            return dict_result

        # Use translation service (dict → LLM → DeepL chain)
        result = await translation_service.translate(text_ka, source="ka", target="en")
        self._session_cache_ka_en[text_ka] = result
        logger.debug("Translator KA→EN: '%s' → '%s'", text_ka[:40], result[:40])
        return result

    async def translate_results(self, results_en: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Translate result items from English to Georgian.

        Translates title and body fields for each result item.
        Uses batch translation for efficiency.

        Args:
            results_en: List of result dicts with English title/body.

        Returns:
            Same list with title/body translated to Georgian.
        """
        if not results_en:
            return results_en

        # Collect all texts that need translation
        titles = []
        bodies = []
        for item in results_en:
            titles.append(item.get("title", ""))
            bodies.append(item.get("body", item.get("abstract", item.get("abstract_summary", "")))[:500])

        # Batch translate titles and bodies
        all_texts = titles + bodies
        translated = await translation_service.batch_translate(all_texts, source="en", target="ka")

        translated_titles = translated[:len(titles)]
        translated_bodies = translated[len(titles):]

        # Apply translations back
        for i, item in enumerate(results_en):
            if i < len(translated_titles) and translated_titles[i]:
                item["title_ka"] = translated_titles[i]
            if i < len(translated_bodies) and translated_bodies[i]:
                item["body_ka"] = translated_bodies[i]

        return results_en

    async def ensure_terminology_consistency(self, text: str) -> str:
        """Ensure consistent medical terminology in Georgian text.

        Replaces informal/inconsistent terms with standard Georgian medical terms.

        Args:
            text: Georgian text to normalize.

        Returns:
            Text with consistent medical terminology.
        """
        if not text or len(text) < 10:
            return text

        # Build term replacement map from dictionary
        # Look for English terms that leaked into Georgian text and replace them
        replacements_made = False
        result = text

        for en_term, ka_term in _EN_TO_KA.items():
            if en_term in result.lower() and len(en_term) > 3:
                pattern = _TERMINOLOGY_PATTERNS.get(en_term)
                if not pattern:
                    pattern = re.compile(re.escape(en_term), re.IGNORECASE)
                    _TERMINOLOGY_PATTERNS[en_term] = pattern
                new_result = pattern.sub(ka_term, result)
                if new_result != result:
                    result = new_result
                    replacements_made = True

        if replacements_made:
            logger.debug("Terminology consistency: %d replacements", 1)

        return result

    async def translate_findings(self, findings: list[str]) -> list[str]:
        """Translate a list of finding strings from English to Georgian."""
        if not findings:
            return findings
        return await translation_service.batch_translate(findings, source="en", target="ka")

    async def translate_text_en_to_ka(self, text_en: str) -> str:
        """Translate a single English text to Georgian."""
        if not text_en or not text_en.strip():
            return ""

        text_en = text_en.strip()

        # Check session cache
        if text_en in self._session_cache_en_ka:
            return self._session_cache_en_ka[text_en]

        # Check static dictionary
        ka = _EN_TO_KA.get(text_en.lower())
        if ka:
            self._session_cache_en_ka[text_en] = ka
            return ka

        result = await translation_service.translate(text_en, source="en", target="ka")
        self._session_cache_en_ka[text_en] = result
        return result
