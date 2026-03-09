"""Cochrane Library integration via Europe PMC.

Cochrane systematic reviews are indexed in Europe PMC.
This client wraps EuropePMCClient with Cochrane-specific filters
to surface high-evidence systematic reviews and meta-analyses.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

# Cochrane-specific query filters for Europe PMC
_COCHRANE_FILTERS = (
    '(SRC:CTX OR PUBLISHER:"Cochrane Database of Systematic Reviews"'
    ' OR JOURNAL:"Cochrane Database Syst Rev")'
)

_SYSTEMATIC_REVIEW_FILTERS = (
    '(TITLE:"systematic review" OR TITLE:"meta-analysis"'
    ' OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis")'
)


class CochraneSearchClient:
    """Async client for Cochrane systematic reviews via Europe PMC."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search_reviews(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Search for Cochrane systematic reviews matching query."""
        # Combine user query with Cochrane source filter
        full_query = f"({query}) AND {_COCHRANE_FILTERS}"
        return await self._search(full_query, max_results)

    async def search_systematic_reviews(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Search for any systematic reviews / meta-analyses (broader than Cochrane)."""
        full_query = f"({query}) AND {_SYSTEMATIC_REVIEW_FILTERS}"
        return await self._search(full_query, max_results)

    async def get_review(self, pmid: str) -> dict[str, Any] | None:
        """Get a single review by PMID."""
        results = await self._search(f"EXT_ID:{pmid} AND SRC:MED", max_results=1)
        return results[0] if results else None

    async def _search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Execute search against Europe PMC with given query."""
        params = {
            "query": query,
            "resultType": "core",
            "pageSize": str(min(max_results, 25)),
            "format": "json",
            "sort": "RELEVANCE",
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(BASE_URL, params=params)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "Cochrane | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                results = data.get("resultList", {}).get("result", [])
                logger.info(
                    "Cochrane OK | results=%d | %dms | query=%s",
                    len(results), elapsed_ms, query[:80],
                )
                return [self._parse_result(r) for r in results]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("Cochrane timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Cochrane error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    def _parse_result(self, r: dict) -> dict[str, Any]:
        pmid = r.get("pmid", "")
        doi = r.get("doi", "")
        return {
            "pmid": pmid,
            "title": r.get("title", ""),
            "abstract": r.get("abstractText", ""),
            "journal": r.get("journalTitle", ""),
            "year": r.get("pubYear"),
            "doi": doi,
            "is_open_access": r.get("isOpenAccess") == "Y",
            "source_url": f"https://europepmc.org/article/MED/{pmid}" if pmid else "",
            "evidence_type": self._detect_evidence_type(r),
            "source_db": "Cochrane/Europe PMC",
        }

    def _detect_evidence_type(self, r: dict) -> str:
        """Detect evidence type from publication metadata."""
        title = (r.get("title", "") or "").lower()
        journal = (r.get("journalTitle", "") or "").lower()

        if "cochrane" in journal:
            return "systematic_review"
        if "meta-analysis" in title or "meta analysis" in title:
            return "meta_analysis"
        if "systematic review" in title:
            return "systematic_review"
        return "review"
