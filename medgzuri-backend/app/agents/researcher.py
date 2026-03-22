"""Agent 1: Research Agent — orchestrates all search sources.

Decides WHICH sources to query based on the query type:
  - Rare diseases   → OrphaNet + ClinicalTrials
  - Drug queries    → OpenFDA + PubMed
  - Latest research → OpenAlex + Europe PMC
  - General         → PubMed + ClinicalTrials + OpenAlex
"""

import asyncio
import logging
from typing import Any

from app.services.llm_client import call_sonnet_json

logger = logging.getLogger(__name__)


# ═══════════════ QUERY TYPE DETECTION ═══════════════

_RARE_DISEASE_MARKERS = [
    "იშვიათი", "rare", "orphan", "genetic", "გენეტიკური",
    "სინდრომი", "syndrome", "congenital", "თანდაყოლილი",
]

_DRUG_MARKERS = [
    "წამალი", "მედიკამენტი", "drug", "medication", "თერაპია",
    "therapy", "treatment", "მკურნალობა", "ინჰიბიტორი",
    "inhibitor", "ანტიბიოტიკი", "antibiotic", "დოზა", "dose",
]


def _detect_query_type(query: str) -> str:
    """Detect query type from keywords: rare_disease | drug | latest | general."""
    q_lower = query.lower()
    if any(m in q_lower for m in _RARE_DISEASE_MARKERS):
        return "rare_disease"
    if any(m in q_lower for m in _DRUG_MARKERS):
        return "drug"
    return "general"


# ═══════════════ RAW RESULTS MODEL ═══════════════

class RawResults:
    """Container for raw results from all sources."""

    def __init__(self) -> None:
        self.pubmed: list[dict[str, Any]] = []
        self.clinical_trials: list[dict[str, Any]] = []
        self.openalex: list[dict[str, Any]] = []
        self.europe_pmc: list[dict[str, Any]] = []
        self.cochrane: list[dict[str, Any]] = []
        self.orphanet: list[dict[str, Any]] = []
        self.openfda: list[dict[str, Any]] = []
        self.sources_queried: list[str] = []
        self.errors: list[str] = []

    @property
    def total_count(self) -> int:
        return (
            len(self.pubmed) + len(self.clinical_trials) + len(self.openalex)
            + len(self.europe_pmc) + len(self.cochrane) + len(self.orphanet)
            + len(self.openfda)
        )

    def all_items(self) -> list[dict[str, Any]]:
        """Return all results as a flat list with source tags."""
        items: list[dict[str, Any]] = []
        for item in self.pubmed:
            items.append({**item, "_source": "PubMed"})
        for item in self.clinical_trials:
            items.append({**item, "_source": "ClinicalTrials.gov"})
        for item in self.openalex:
            items.append({**item, "_source": "OpenAlex"})
        for item in self.europe_pmc:
            items.append({**item, "_source": "Europe PMC"})
        for item in self.cochrane:
            items.append({**item, "_source": "Cochrane"})
        for item in self.orphanet:
            items.append({**item, "_source": "OrphaNet"})
        for item in self.openfda:
            items.append({**item, "_source": "OpenFDA"})
        return items


# ═══════════════ RESEARCHER AGENT ═══════════════

class ResearcherAgent:
    """Orchestrates search across all available sources based on query type."""

    def __init__(self) -> None:
        # Lazy-loaded integration clients
        self._pubmed = None
        self._ct = None
        self._openalex = None
        self._epmc = None
        self._cochrane = None
        self._orphanet = None
        self._openfda = None

    def _get_pubmed(self):
        if self._pubmed is None:
            from app.integrations.pubmed import PubMedClient
            self._pubmed = PubMedClient()
        return self._pubmed

    def _get_ct(self):
        if self._ct is None:
            from app.integrations.clinicaltrials_gov import ClinicalTrialsClient
            self._ct = ClinicalTrialsClient()
        return self._ct

    def _get_openalex(self):
        if self._openalex is None:
            from app.integrations.openalex import OpenAlexClient
            self._openalex = OpenAlexClient()
        return self._openalex

    def _get_epmc(self):
        if self._epmc is None:
            from app.integrations.europe_pmc import EuropePMCClient
            self._epmc = EuropePMCClient()
        return self._epmc

    def _get_cochrane(self):
        if self._cochrane is None:
            from app.integrations.cochrane import CochraneSearchClient
            self._cochrane = CochraneSearchClient()
        return self._cochrane

    def _get_orphanet(self):
        if self._orphanet is None:
            from app.integrations.orphanet import OrphanetClient
            self._orphanet = OrphanetClient()
        return self._orphanet

    def _get_openfda(self):
        if self._openfda is None:
            from app.integrations.drugbank_open import OpenFDAClient
            self._openfda = OpenFDAClient()
        return self._openfda

    async def research(self, query: str, query_type: str | None = None) -> RawResults:
        """Research a query across appropriate sources.

        Args:
            query: English-language medical query.
            query_type: Override auto-detection: rare_disease | drug | latest | general.

        Returns:
            RawResults with data from all queried sources.
        """
        if not query_type:
            query_type = _detect_query_type(query)

        logger.info("Researcher | query='%s' | type=%s", query[:60], query_type)

        results = RawResults()

        # Build task list based on query type
        tasks = self._plan_sources(query, query_type)
        logger.info("Researcher | planned sources: %s", [t[0] for t in tasks])

        # Execute all searches in parallel
        gathered = await asyncio.gather(
            *[t[1] for t in tasks],
            return_exceptions=True,
        )

        for (source_name, _), outcome in zip(tasks, gathered):
            results.sources_queried.append(source_name)
            if isinstance(outcome, Exception):
                err_msg = f"{source_name}: {str(outcome)[:100]}"
                results.errors.append(err_msg)
                logger.warning("Researcher | %s failed: %s", source_name, str(outcome)[:100])
            else:
                self._store_results(results, source_name, outcome)

        logger.info(
            "Researcher done | total=%d | sources=%d | errors=%d",
            results.total_count, len(results.sources_queried), len(results.errors),
        )
        return results

    def _plan_sources(
        self, query: str, query_type: str,
    ) -> list[tuple[str, Any]]:
        """Decide which sources to query and return (name, coroutine) pairs."""
        tasks: list[tuple[str, Any]] = []

        if query_type == "rare_disease":
            # Prioritize OrphaNet + ClinicalTrials, also PubMed
            tasks.append(("OrphaNet", self._search_orphanet(query)))
            tasks.append(("ClinicalTrials.gov", self._search_ct(query)))
            tasks.append(("PubMed", self._search_pubmed(query)))
            tasks.append(("Cochrane", self._search_cochrane(query)))

        elif query_type == "drug":
            # Prioritize OpenFDA + PubMed
            tasks.append(("OpenFDA", self._search_openfda(query)))
            tasks.append(("PubMed", self._search_pubmed(query)))
            tasks.append(("ClinicalTrials.gov", self._search_ct(query)))
            tasks.append(("Europe PMC", self._search_epmc(query)))

        elif query_type == "latest":
            # Prioritize OpenAlex + Europe PMC
            tasks.append(("OpenAlex", self._search_openalex(query)))
            tasks.append(("Europe PMC", self._search_epmc(query)))
            tasks.append(("PubMed", self._search_pubmed(query)))

        else:
            # General — broad search
            tasks.append(("PubMed", self._search_pubmed(query)))
            tasks.append(("ClinicalTrials.gov", self._search_ct(query)))
            tasks.append(("OpenAlex", self._search_openalex(query)))
            tasks.append(("Europe PMC", self._search_epmc(query)))
            tasks.append(("Cochrane", self._search_cochrane(query)))

        return tasks

    def _store_results(
        self, results: RawResults, source: str, data: list[dict[str, Any]],
    ) -> None:
        """Store fetched data into the correct field."""
        source_map = {
            "PubMed": "pubmed",
            "ClinicalTrials.gov": "clinical_trials",
            "OpenAlex": "openalex",
            "Europe PMC": "europe_pmc",
            "Cochrane": "cochrane",
            "OrphaNet": "orphanet",
            "OpenFDA": "openfda",
        }
        field = source_map.get(source)
        if field and isinstance(data, list):
            setattr(results, field, data)

    # ═══════════════ SOURCE SEARCH METHODS ═══════════════

    async def _search_pubmed(self, query: str) -> list[dict]:
        return await self._get_pubmed().search(query, max_results=15)

    async def _search_ct(self, query: str) -> list[dict]:
        return await self._get_ct().search(query, max_results=15)

    async def _search_openalex(self, query: str) -> list[dict]:
        return await self._get_openalex().search_works(query, max_results=15)

    async def _search_epmc(self, query: str) -> list[dict]:
        return await self._get_epmc().search(query, max_results=10)

    async def _search_cochrane(self, query: str) -> list[dict]:
        return await self._get_cochrane().search_reviews(query, max_results=10)

    async def _search_orphanet(self, query: str) -> list[dict]:
        return await self._get_orphanet().search_disease(query)

    async def _search_openfda(self, query: str) -> list[dict]:
        return await self._get_openfda().search_drug(query)
