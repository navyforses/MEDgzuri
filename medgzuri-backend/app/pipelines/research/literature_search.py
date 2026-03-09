"""A3 — Literature Search Agent.

Searches PubMed + Europe PMC + OpenAlex + Cochrane, then uses Claude Sonnet
to select the most relevant articles and generate Georgian summaries.
Evidence grading is applied to all results.
"""

import asyncio
import json
import logging

from app.integrations.cochrane import CochraneSearchClient
from app.integrations.europe_pmc import EuropePMCClient
from app.integrations.openalex import OpenAlexClient
from app.integrations.pubmed import PubMedClient
from app.orchestrator.schemas import NormalizedTerms
from app.services.evidence_grader import grade_and_sort
from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)

DEFAULT_PUB_TYPES = [
    "systematic review", "meta-analysis", "clinical trial", "review",
]


class LiteratureSearchAgent:
    """A3 agent — search and summarize medical literature."""

    def __init__(self):
        self.pubmed = PubMedClient()
        self.europe_pmc = EuropePMCClient()
        self.openalex = OpenAlexClient()
        self.cochrane = CochraneSearchClient()

    async def search(
        self,
        terms: NormalizedTerms,
        max_results: int = 10,
        original_query: str = "",
    ) -> dict:
        """Search literature and return summarized results.

        Returns: {"articles": [...], "field_summary": "..."}
        """
        query = terms.search_queries.get("pubmed", terms.english_primary)

        # Parallel search — PubMed, Europe PMC, OpenAlex, Cochrane
        pubmed_task = self.pubmed.search(
            query=query,
            max_results=max_results,
            years_back=3,
            pub_types=DEFAULT_PUB_TYPES,
        )
        epmc_task = self.europe_pmc.search(
            query=terms.english_primary,
            max_results=10,
        )
        openalex_task = self.openalex.search_works(
            query=terms.english_primary,
            per_page=10,
        )
        cochrane_task = self.cochrane.search_reviews(
            query=terms.english_primary,
            max_results=5,
        )

        results = await asyncio.gather(
            pubmed_task, epmc_task, openalex_task, cochrane_task,
            return_exceptions=True,
        )

        # Collect articles
        all_articles = []
        for i, result in enumerate(results):
            source = ["PubMed", "Europe PMC", "OpenAlex", "Cochrane"][i]
            if isinstance(result, Exception):
                logger.warning("A3 %s failed | %s", source, str(result)[:100])
                continue
            if isinstance(result, list):
                all_articles.extend(result)
                logger.info("A3 %s | %d articles", source, len(result))

        if not all_articles:
            logger.warning("A3 no articles found")
            return {"articles": [], "field_summary": ""}

        # Deduplicate by PMID and DOI
        seen_pmids: set[str] = set()
        seen_dois: set[str] = set()
        unique = []
        for a in all_articles:
            pmid = a.get("pmid", "")
            doi = a.get("doi", "")
            if pmid and pmid in seen_pmids:
                continue
            if doi and doi in seen_dois:
                continue
            if pmid:
                seen_pmids.add(pmid)
            if doi:
                seen_dois.add(doi)
            unique.append(a)

        # Grade evidence and sort by quality (best evidence first)
        graded = grade_and_sort(unique)

        # Use Claude Sonnet to select top articles and generate Georgian summaries
        return await self._summarize(graded[:10], original_query or terms.english_primary)

    async def _summarize(self, articles: list[dict], query: str) -> dict:
        """Use LLM to select top articles and generate Georgian summaries."""
        system_prompt = load_prompt("literature_summarizer")

        # Prepare article data for LLM (title + abstract excerpts)
        article_briefs = []
        for a in articles:
            abstract = a.get("abstract", "")
            if len(abstract) > 500:
                abstract = abstract[:500] + "..."
            article_briefs.append({
                "pmid": a.get("pmid", ""),
                "title": a.get("title", ""),
                "abstract": abstract,
                "journal": a.get("journal", ""),
                "year": a.get("year"),
                "doi": a.get("doi", ""),
                "evidence_level": a.get("evidence_level", ""),
                "evidence_label": a.get("evidence_label", ""),
                "evidence_marker": a.get("evidence_marker", ""),
            })

        user_message = (
            f"Patient query: {query}\n\n"
            f"Articles ({len(article_briefs)}):\n"
            f"{json.dumps(article_briefs, indent=2, ensure_ascii=False)}"
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and "articles" in result:
                logger.info("A3 summarized | articles=%d", len(result["articles"]))
                return result
        except Exception as e:
            logger.warning("A3 summarization failed | %s", str(e)[:200])

        # Fallback — return raw articles without Georgian summaries
        return {
            "articles": [
                {
                    "pmid": a.get("pmid", ""),
                    "title": a.get("title", ""),
                    "abstract_summary": a.get("abstract", "")[:300],
                    "journal": a.get("journal", ""),
                    "year": a.get("year"),
                    "doi": a.get("doi", ""),
                    "relevance_note": "",
                    "evidence_level": a.get("evidence_level", ""),
                    "evidence_label": a.get("evidence_label", ""),
                    "evidence_marker": a.get("evidence_marker", ""),
                }
                for a in articles[:7]
            ],
            "field_summary": "",
        }
