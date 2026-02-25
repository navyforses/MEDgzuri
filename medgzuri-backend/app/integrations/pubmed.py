"""PubMed E-utilities integration (esearch + efetch).

Docs: https://www.ncbi.nlm.nih.gov/books/NBK25500/
"""

import logging
import time
from typing import Any
from xml.etree import ElementTree

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


class PubMedClient:
    """Async client for PubMed E-utilities API."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search(
        self,
        query: str,
        max_results: int = 20,
        years_back: int = 3,
        pub_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search PubMed and return structured article data."""
        pmids = await self._esearch(query, max_results, years_back, pub_types)
        if not pmids:
            return []
        return await self._efetch(pmids)

    async def _esearch(
        self, query: str, max_results: int, years_back: int,
        pub_types: list[str] | None,
    ) -> list[str]:
        """Step 1: Search and retrieve PMIDs."""
        # Build query with filters
        full_query = query
        if pub_types:
            type_filter = " OR ".join(f'"{t}"[pt]' for t in pub_types)
            full_query = f"({query}) AND ({type_filter})"

        params = {
            "db": "pubmed",
            "term": full_query,
            "retmax": str(max_results),
            "sort": "relevance",
            "datetype": "pdat",
            "reldate": str(years_back * 365),
            "retmode": "json",
        }
        if settings.ncbi_api_key:
            params["api_key"] = settings.ncbi_api_key

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(ESEARCH_URL, params=params)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning("PubMed esearch | status=%d | %dms", resp.status_code, elapsed_ms)
                    return []

                data = resp.json()
                pmids = data.get("esearchresult", {}).get("idlist", [])
                logger.info("PubMed esearch OK | PMIDs=%d | %dms | query=%s", len(pmids), elapsed_ms, query[:80])
                return pmids

        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("PubMed esearch error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    async def _efetch(self, pmids: list[str]) -> list[dict[str, Any]]:
        """Step 2: Fetch article details for given PMIDs."""
        params = {
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "xml",
            "rettype": "abstract",
        }
        if settings.ncbi_api_key:
            params["api_key"] = settings.ncbi_api_key

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(EFETCH_URL, params=params)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning("PubMed efetch | status=%d | %dms", resp.status_code, elapsed_ms)
                    return []

                articles = self._parse_xml(resp.text)
                logger.info("PubMed efetch OK | articles=%d | %dms", len(articles), elapsed_ms)
                return articles

        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("PubMed efetch error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    def _parse_xml(self, xml_text: str) -> list[dict[str, Any]]:
        """Parse PubMed XML response into structured articles."""
        articles = []
        try:
            root = ElementTree.fromstring(xml_text)
        except ElementTree.ParseError as e:
            logger.error("PubMed XML parse error: %s", str(e)[:200])
            return []

        for article_elem in root.findall(".//PubmedArticle"):
            articles.append(self._parse_article(article_elem))
        return articles

    def _parse_article(self, elem: ElementTree.Element) -> dict[str, Any]:
        """Parse a single PubmedArticle XML element."""
        medline = elem.find(".//MedlineCitation")
        article = medline.find(".//Article") if medline is not None else None

        pmid = _xml_text(medline, ".//PMID")
        title = _xml_text(article, ".//ArticleTitle")
        journal = _xml_text(article, ".//Journal/Title")

        # Abstract — concatenate all parts
        abstract_parts = []
        if article is not None:
            for text_elem in article.findall(".//Abstract/AbstractText"):
                label = text_elem.get("Label", "")
                text = text_elem.text or ""
                if label:
                    abstract_parts.append(f"{label}: {text}")
                else:
                    abstract_parts.append(text)
        abstract = " ".join(abstract_parts)

        # Year
        year = _xml_text(article, ".//Journal/JournalIssue/PubDate/Year")

        # DOI
        doi = ""
        for id_elem in elem.findall(".//PubmedData/ArticleIdList/ArticleId"):
            if id_elem.get("IdType") == "doi":
                doi = id_elem.text or ""
                break

        return {
            "pmid": pmid,
            "title": title,
            "abstract": abstract,
            "journal": journal,
            "year": int(year) if year.isdigit() else None,
            "doi": doi,
            "source_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
        }


def _xml_text(parent: ElementTree.Element | None, path: str) -> str:
    if parent is None:
        return ""
    elem = parent.find(path)
    return (elem.text or "").strip() if elem is not None else ""
