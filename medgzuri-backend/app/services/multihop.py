"""Multi-hop search — generates follow-up queries from initial results.

Takes initial search results, uses Claude Sonnet to identify knowledge gaps,
generates 2–3 follow-up queries, runs them in parallel, and merges results.
"""

import asyncio
import json
import logging
from typing import Any

from app.services.llm_client import call_sonnet_json

logger = logging.getLogger(__name__)


async def generate_followup_queries(
    original_query: str,
    results: list[dict[str, Any]],
    max_queries: int = 3,
) -> list[str]:
    """Analyze initial results and generate follow-up search queries.

    Uses Claude Sonnet to identify gaps and generate targeted follow-up queries.
    Returns a list of 2–3 English search queries for medical literature.
    """
    if not results:
        return []

    # Prepare compact summaries of initial results
    result_summaries = []
    for r in results[:8]:
        title = r.get("title", "")
        abstract = (r.get("abstract", "") or r.get("abstract_summary", ""))[:200]
        evidence = r.get("evidence_level", "")
        result_summaries.append(
            f"- {title} [Level {evidence}]" if evidence else f"- {title}"
        )

    system = (
        "You are a medical research assistant. Given a search query and initial results, "
        "identify knowledge gaps and generate 2-3 follow-up search queries.\n\n"
        "Rules:\n"
        "- Queries must be in English (for PubMed/Europe PMC)\n"
        "- Focus on: related treatments, mechanisms, recent trials, guidelines\n"
        "- Do NOT repeat the original query\n"
        "- Each query should explore a different angle\n"
        "- Keep queries concise (3-8 words)\n\n"
        "Return JSON: {\"queries\": [\"query1\", \"query2\", \"query3\"]}"
    )

    user_msg = (
        f"Original query: {original_query}\n\n"
        f"Initial results ({len(result_summaries)}):\n"
        + "\n".join(result_summaries)
    )

    try:
        result = await call_sonnet_json(system, user_msg, max_tokens=500)
        if result and "queries" in result:
            queries = result["queries"][:max_queries]
            logger.info(
                "Multi-hop | generated %d follow-up queries for: %s",
                len(queries), original_query[:50],
            )
            return queries
    except Exception as e:
        logger.warning("Multi-hop query generation failed | %s", str(e)[:200])

    return []


async def execute_multihop(
    original_query: str,
    initial_results: list[dict[str, Any]],
    search_fn,
    max_queries: int = 3,
) -> list[dict[str, Any]]:
    """Run multi-hop search: generate follow-ups, search, merge, deduplicate.

    Args:
        original_query: The original user search query
        initial_results: Results from the first search round
        search_fn: Async callable(query: str) -> list[dict] for running follow-up searches
        max_queries: Maximum number of follow-up queries

    Returns:
        Merged and deduplicated results (initial + follow-up)
    """
    followup_queries = await generate_followup_queries(
        original_query, initial_results, max_queries,
    )

    if not followup_queries:
        logger.info("Multi-hop | no follow-up queries generated")
        return initial_results

    # Run follow-up searches in parallel
    tasks = [search_fn(q) for q in followup_queries]
    followup_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Collect all new results
    new_results = []
    for i, result in enumerate(followup_results):
        if isinstance(result, Exception):
            logger.warning(
                "Multi-hop search %d failed | %s",
                i + 1, str(result)[:100],
            )
            continue
        if isinstance(result, list):
            new_results.extend(result)
            logger.info("Multi-hop search %d | %d results", i + 1, len(result))

    if not new_results:
        return initial_results

    # Merge and deduplicate
    merged = _deduplicate(initial_results + new_results)
    logger.info(
        "Multi-hop complete | initial=%d | new=%d | merged=%d",
        len(initial_results), len(new_results), len(merged),
    )
    return merged


def _deduplicate(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate results by PMID and DOI."""
    seen_pmids: set[str] = set()
    seen_dois: set[str] = set()
    unique = []

    for r in results:
        pmid = r.get("pmid", "")
        doi = r.get("doi", "")

        if pmid and pmid in seen_pmids:
            continue
        if doi and doi in seen_dois:
            continue

        if pmid:
            seen_pmids.add(pmid)
        if doi:
            seen_dois.add(doi)
        unique.append(r)

    return unique
