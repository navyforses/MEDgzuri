"""Orphanet rare disease integration via Orphadata API.

Docs: https://api.orphadata.com/docs
Provides access to rare disease nomenclature, cross-referencing, and classifications.
No API key required.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.orphadata.com"


class OrphanetClient:
    """Async client for Orphadata API (Orphanet rare disease data)."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search_disease(
        self,
        query: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Search rare diseases by name.

        Uses the Orphadata approximation endpoint for fuzzy name matching.
        Falls back to the cross-referencing endpoint if needed.
        """
        results = await self._search_by_name(query, limit)
        if results:
            return results

        # Fallback: try cross-referencing endpoint
        return await self._search_cross_ref(query, limit)

    async def get_disease(self, orpha_code: str) -> dict[str, Any] | None:
        """Get disease details by ORPHAcode.

        Returns disease name, synonyms, and cross-references (ICD-10, OMIM, etc.).
        """
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Get basic info via cross-referencing endpoint
                resp = await client.get(
                    f"{BASE_URL}/rd-cross-referencing/orphacodes/{orpha_code}",
                    headers={"Accept": "application/json"},
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "Orphanet get_disease | status=%d | %dms | orpha=%s",
                        resp.status_code, elapsed_ms, orpha_code,
                    )
                    return None

                data = resp.json()
                logger.info(
                    "Orphanet get_disease OK | %dms | orpha=%s",
                    elapsed_ms, orpha_code,
                )
                return self._parse_disease_detail(data)

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "Orphanet get_disease timeout | %dms | orpha=%s", elapsed_ms, orpha_code,
            )
            return None
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Orphanet get_disease error | %dms | %s", elapsed_ms, str(e)[:200])
            return None

    # ═══════════════ INTERNAL SEARCH METHODS ═══════════════

    async def _search_by_name(
        self, query: str, limit: int,
    ) -> list[dict[str, Any]]:
        """Search via the approximation/nomenclature endpoint."""
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/rd-nomenclature",
                    params={"name": query},
                    headers={"Accept": "application/json"},
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "Orphanet name search | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                items = self._extract_items(data)
                results = [self._parse_disease(d) for d in items[:limit]]
                logger.info(
                    "Orphanet name search OK | results=%d | %dms | query=%s",
                    len(results), elapsed_ms, query[:80],
                )
                return results

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("Orphanet name search timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Orphanet name search error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    async def _search_cross_ref(
        self, query: str, limit: int,
    ) -> list[dict[str, Any]]:
        """Fallback search via cross-referencing endpoint."""
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/rd-cross-referencing",
                    params={"name": query},
                    headers={"Accept": "application/json"},
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "Orphanet cross-ref search | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                items = self._extract_items(data)
                results = [self._parse_disease_cross_ref(d) for d in items[:limit]]
                logger.info(
                    "Orphanet cross-ref OK | results=%d | %dms | query=%s",
                    len(results), elapsed_ms, query[:80],
                )
                return results

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "Orphanet cross-ref timeout | %dms | query=%s", elapsed_ms, query[:80],
            )
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Orphanet cross-ref error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    # ═══════════════ PARSING ═══════════════

    @staticmethod
    def _extract_items(data: Any) -> list[dict]:
        """Extract disease items from various Orphadata response shapes."""
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Common shapes: {results: [...]}, {data: [...]}, or flat dict
            for key in ("results", "data", "items", "disorders"):
                if key in data and isinstance(data[key], list):
                    return data[key]
            # Single result
            if "ORPHAcode" in data or "orphaCode" in data:
                return [data]
        return []

    def _parse_disease(self, d: dict) -> dict[str, Any]:
        """Parse a disease item from the nomenclature endpoint."""
        orpha_code = str(d.get("ORPHAcode", d.get("orphaCode", "")))
        name = d.get("Preferred term", d.get("preferredTerm", d.get("name", "")))

        synonyms = []
        syn_list = d.get("Synonym", d.get("synonyms", []))
        if isinstance(syn_list, list):
            for s in syn_list:
                if isinstance(s, str):
                    synonyms.append(s)
                elif isinstance(s, dict):
                    synonyms.append(s.get("Synonym", s.get("name", "")))

        definition = d.get("Definition", d.get("definition", ""))
        if isinstance(definition, list) and definition:
            definition = definition[0] if isinstance(definition[0], str) else ""

        return {
            "orpha_code": orpha_code,
            "name": name,
            "synonyms": synonyms,
            "definition": definition if isinstance(definition, str) else "",
            "disease_type": d.get("DisorderType", d.get("disorderType", "")),
            "url": f"https://www.orpha.net/en/disease/detail/{orpha_code}" if orpha_code else "",
            "source": "Orphanet",
        }

    def _parse_disease_cross_ref(self, d: dict) -> dict[str, Any]:
        """Parse a disease from the cross-referencing endpoint (includes ICD-10, OMIM)."""
        base = self._parse_disease(d)

        # Extract cross-references
        cross_refs: list[dict[str, str]] = []
        refs = d.get("ExternalReference", d.get("externalReferences", []))
        if isinstance(refs, list):
            for ref in refs:
                source = ref.get("Source", ref.get("source", ""))
                reference = ref.get("Reference", ref.get("reference", ""))
                if source and reference:
                    cross_refs.append({"source": source, "reference": reference})

        # Extract ICD-10 specifically
        icd10_codes = [
            r["reference"] for r in cross_refs
            if r["source"].upper().startswith("ICD")
        ]

        base["cross_references"] = cross_refs
        base["icd10_codes"] = icd10_codes
        return base

    def _parse_disease_detail(self, data: dict) -> dict[str, Any]:
        """Parse full disease detail response."""
        # The detail endpoint may wrap data differently
        items = self._extract_items(data)
        if items:
            result = self._parse_disease_cross_ref(items[0])
        else:
            result = self._parse_disease_cross_ref(data)
        return result
