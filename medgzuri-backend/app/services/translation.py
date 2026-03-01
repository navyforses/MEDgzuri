"""S1 — Translation service with fallback chain.

Strategy (in order):
  1. Static dictionary (medical_terms.py) — instant, free
  2. Claude Sonnet — LLM-based medical translation
  3. DeepL API — backup if DEEPL_API_KEY is configured
"""

import logging

import httpx

from app.config import settings
from app.utils.medical_terms import KA_TO_EN, MEDICATIONS_KA_TO_EN

logger = logging.getLogger(__name__)

# Reverse dictionary for EN → KA
EN_TO_KA = {v: k for k, v in KA_TO_EN.items()}
EN_TO_KA.update({v: k for k, v in MEDICATIONS_KA_TO_EN.items()})


class TranslationService:
    """Unified translation with fallback chain: dictionary → LLM → DeepL."""

    async def translate(self, text: str, source: str = "ka", target: str = "en") -> str:
        """Translate text between Georgian and English."""
        if not text or not text.strip():
            return ""

        # Step 1: Dictionary lookup
        result = self._dict_lookup(text.strip(), source, target)
        if result:
            logger.debug("Translation (dict): '%s' → '%s'", text[:30], result[:30])
            return result

        # Step 2: Claude Sonnet
        result = await self._llm_translate(text, source, target)
        if result:
            return result

        # Step 3: DeepL API (if configured)
        if settings.deepl_api_key:
            result = await self._deepl_translate(text, source, target)
            if result:
                return result

        # Fallback: return original text
        logger.warning("Translation failed for all strategies — returning original")
        return text

    async def translate_medical_term(self, term_ka: str) -> str:
        """Translate a single Georgian medical term to English."""
        return await self.translate(term_ka, source="ka", target="en")

    async def batch_translate(self, terms: list[str], source: str = "ka", target: str = "en") -> list[str]:
        """Translate multiple terms. Uses dictionary first, then batches LLM calls."""
        results = []
        llm_needed = []
        llm_indices = []

        for i, term in enumerate(terms):
            dict_result = self._dict_lookup(term.strip(), source, target)
            if dict_result:
                results.append(dict_result)
            else:
                results.append(None)
                llm_needed.append(term)
                llm_indices.append(i)

        # Batch LLM translation for remaining terms
        if llm_needed:
            llm_results = await self._llm_batch_translate(llm_needed, source, target)
            for idx, translation in zip(llm_indices, llm_results):
                results[idx] = translation

        # Fill any remaining Nones with originals
        return [r if r else terms[i] for i, r in enumerate(results)]

    def _dict_lookup(self, text: str, source: str, target: str) -> str | None:
        """Look up in static dictionary."""
        if source == "ka" and target == "en":
            return KA_TO_EN.get(text) or MEDICATIONS_KA_TO_EN.get(text)
        elif source == "en" and target == "ka":
            return EN_TO_KA.get(text.lower())
        return None

    async def _llm_translate(self, text: str, source: str, target: str) -> str | None:
        """Translate using Claude Sonnet."""
        if not settings.has_anthropic_key:
            return None

        try:
            from app.services.llm_client import call_sonnet

            src_name = "ქართული" if source == "ka" else "English"
            tgt_name = "English" if target == "en" else "ქართული"

            system = (
                f"You are a medical translator. Translate the following medical text "
                f"from {src_name} to {tgt_name}. Return ONLY the translation, nothing else. "
                f"Preserve medical terminology accuracy."
            )
            result = await call_sonnet(system, text, max_tokens=500)
            result = result.strip().strip('"').strip("'")
            if result:
                logger.debug("Translation (LLM): '%s' → '%s'", text[:30], result[:30])
                return result
        except Exception as e:
            logger.warning("LLM translation failed: %s", str(e)[:100])

        return None

    async def _llm_batch_translate(self, terms: list[str], source: str, target: str) -> list[str]:
        """Batch translate multiple terms with a single LLM call."""
        if not settings.has_anthropic_key or not terms:
            return terms

        try:
            from app.services.llm_client import call_sonnet

            src_name = "ქართული" if source == "ka" else "English"
            tgt_name = "English" if target == "en" else "ქართული"

            numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(terms))
            system = (
                f"You are a medical translator. Translate each medical term from "
                f"{src_name} to {tgt_name}. Return ONLY numbered translations, one per line. "
                f"Example output format:\n1. translation1\n2. translation2"
            )
            result = await call_sonnet(system, numbered, max_tokens=1000)

            # Parse numbered results
            translations = []
            for line in result.strip().split("\n"):
                line = line.strip()
                if line and line[0].isdigit():
                    # Remove number prefix like "1. " or "1) "
                    parts = line.split(".", 1) if "." in line[:4] else line.split(")", 1)
                    if len(parts) > 1:
                        translations.append(parts[1].strip())
                    else:
                        translations.append(line)

            # Pad with originals if parsing didn't get all
            while len(translations) < len(terms):
                translations.append(terms[len(translations)])

            return translations[:len(terms)]

        except Exception as e:
            logger.warning("LLM batch translation failed: %s", str(e)[:100])
            return terms

    async def _deepl_translate(self, text: str, source: str, target: str) -> str | None:
        """Translate using DeepL API."""
        lang_map = {"ka": "KA", "en": "EN"}
        source_lang = lang_map.get(source)
        target_lang = lang_map.get(target)

        if not source_lang or not target_lang:
            return None

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api-free.deepl.com/v2/translate",
                    headers={"Authorization": f"DeepL-Auth-Key {settings.deepl_api_key}"},
                    data={
                        "text": text,
                        "source_lang": source_lang,
                        "target_lang": target_lang,
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    result = data["translations"][0]["text"]
                    logger.debug("Translation (DeepL): '%s' → '%s'", text[:30], result[:30])
                    return result
                else:
                    logger.warning("DeepL API error: %d", response.status_code)
        except Exception as e:
            logger.warning("DeepL translation failed: %s", str(e)[:100])

        return None


# Singleton instance
translation_service = TranslationService()
