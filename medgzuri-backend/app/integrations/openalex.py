"""OpenAlex API integration — open scholarly metadata.

Docs: https://docs.openalex.org/
Base URL: https://api.openalex.org
No API key needed (polite pool with email header: 10 req/sec).
"""

import logging
import time
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.openalex.org"


class OpenAlexClient:
    """Async client for OpenAlex API."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        """Build request headers — polite pool requires User-Agent with email."""
        headers = {"Accept": "application/json"}
        if settings.openalex_email:
            headers["User-Agent"] = f"MedGzuri/2.0 (mailto:{settings.openalex_email})"
        return headers

    def _base_params(self) -> dict[str, str]:
        """Polite pool mailto parameter (alternative to User-Agent)."""
        params: dict[str, str] = {}
        if settings.openalex_email:
            params["mailto"] = settings.openalex_email
        return params

    async def search_works(
        self,
        query: str,
        page: int = 1,
        per_page: int = 10,
        type_filter: str | None = None,
        is_oa: bool | None = None,
        from_publication_date: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search scholarly works by query string."""
        params = {
            **self._base_params(),
            "search": query,
            "per_page": str(min(per_page, 50)),
            "page": str(page),
            "sort": "relevance_score:desc",
        }

        # Build filter string
        filters = []
        if type_filter:
            filters.append(f"type:{type_filter}")
        if is_oa is not None:
            filters.append(f"is_oa:{'true' if is_oa else 'false'}")
        if from_publication_date:
            filters.append(f"from_publication_date:{from_publication_date}")
        if filters:
            params["filter"] = ",".join(filters)

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/works", params=params, headers=self._headers(),
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenAlex search | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                works = data.get("results", [])
                logger.info(
                    "OpenAlex search OK | results=%d | %dms | query=%s",
                    len(works), elapsed_ms, query[:80],
                )
                return [self._parse_work(w) for w in works]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("OpenAlex timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenAlex error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    async def get_work(self, openalex_id: str) -> dict[str, Any] | None:
        """Get single work details by OpenAlex ID."""
        params = self._base_params()

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/works/{openalex_id}",
                    params=params,
                    headers=self._headers(),
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenAlex get_work | status=%d | %dms | id=%s",
                        resp.status_code, elapsed_ms, openalex_id,
                    )
                    return None

                data = resp.json()
                logger.info("OpenAlex get_work OK | %dms | id=%s", elapsed_ms, openalex_id)
                return self._parse_work(data)

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("OpenAlex get_work timeout | %dms | id=%s", elapsed_ms, openalex_id)
            return None
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenAlex get_work error | %dms | %s", elapsed_ms, str(e)[:200])
            return None

    async def search_by_concept(
        self,
        concept_id: str,
        page: int = 1,
        per_page: int = 10,
    ) -> list[dict[str, Any]]:
        """Search works by OpenAlex concept ID (e.g. C71924100 for medicine)."""
        params = {
            **self._base_params(),
            "filter": f"concepts.id:{concept_id}",
            "sort": "cited_by_count:desc",
            "per_page": str(min(per_page, 50)),
            "page": str(page),
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/works", params=params, headers=self._headers(),
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenAlex concept search | status=%d | %dms | concept=%s",
                        resp.status_code, elapsed_ms, concept_id,
                    )
                    return []

                data = resp.json()
                works = data.get("results", [])
                logger.info(
                    "OpenAlex concept OK | results=%d | %dms | concept=%s",
                    len(works), elapsed_ms, concept_id,
                )
                return [self._parse_work(w) for w in works]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("OpenAlex concept timeout | %dms | concept=%s", elapsed_ms, concept_id)
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenAlex concept error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    # ═══════════════ PARSING ═══════════════

    def _parse_work(self, w: dict) -> dict[str, Any]:
        """Parse an OpenAlex work object into a structured dict."""
        # აბსტრაქტის რეკონსტრუქცია inverted index-დან
        abstract = self._reconstruct_abstract(w.get("abstract_inverted_index"))

        # ავტორები
        authors = []
        for authorship in w.get("authorships", []):
            author = authorship.get("author", {})
            name = author.get("display_name", "")
            if name:
                authors.append(name)

        # ჟურნალის/წყაროს სახელი
        source = w.get("primary_location", {}) or {}
        source_obj = source.get("source", {}) or {}
        journal = source_obj.get("display_name", "")

        # DOI
        doi = w.get("doi", "") or ""
        if doi.startswith("https://doi.org/"):
            doi = doi[len("https://doi.org/"):]

        # ღია წვდომის URL
        best_oa = w.get("best_oa_location", {}) or {}
        oa_url = best_oa.get("pdf_url") or best_oa.get("landing_page_url") or ""
        if not oa_url and doi:
            oa_url = f"https://doi.org/{doi}"

        # კონცეპტები
        concepts = []
        for c in w.get("concepts", []):
            concepts.append({
                "name": c.get("display_name", ""),
                "score": c.get("score", 0),
            })

        # PMID ამოღება — OpenAlex-ის ids ველიდან
        pmid = ""
        ids = w.get("ids", {}) or {}
        pmid_url = ids.get("pmid", "")
        if pmid_url and "pubmed.ncbi.nlm.nih.gov" in pmid_url:
            pmid = pmid_url.rstrip("/").split("/")[-1]

        return {
            "openalex_id": w.get("id", ""),
            "pmid": pmid,
            "title": w.get("title", "") or "",
            "abstract": abstract,
            "authors": authors,
            "publication_date": w.get("publication_date", ""),
            "year": w.get("publication_year"),
            "journal": journal,
            "doi": doi,
            "cited_by_count": w.get("cited_by_count", 0),
            "is_open_access": w.get("open_access", {}).get("is_oa", False),
            "source_url": oa_url,
            "concepts": concepts,
            "source": "OpenAlex",
        }

    @staticmethod
    def _reconstruct_abstract(inverted_index: dict | None) -> str:
        """Reconstruct abstract text from OpenAlex inverted index format.

        OpenAlex stores abstracts as {word: [position, ...]} — we reverse it
        back into ordered text.
        """
        if not inverted_index:
            return ""

        try:
            word_positions: list[tuple[int, str]] = []
            for word, positions in inverted_index.items():
                for pos in positions:
                    word_positions.append((pos, word))
            word_positions.sort(key=lambda x: x[0])
            return " ".join(word for _, word in word_positions)
        except Exception:
            return ""
