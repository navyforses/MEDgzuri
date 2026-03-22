"""Europe PMC REST API integration.

Docs: https://europepmc.org/RestfulWebService
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


class EuropePMCClient:
    """Async client for Europe PMC REST API."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Search Europe PMC for articles."""
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
                        "Europe PMC | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                results = data.get("resultList", {}).get("result", [])
                logger.info(
                    "Europe PMC OK | results=%d | %dms | query=%s",
                    len(results), elapsed_ms, query[:80],
                )
                return [self._parse_result(r) for r in results]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("Europe PMC timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Europe PMC error | %dms | %s", elapsed_ms, str(e)[:200])
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
        }
