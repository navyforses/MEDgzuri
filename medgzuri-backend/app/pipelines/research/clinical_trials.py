"""A2 — Clinical Trials Agent.

No LLM calls — pure API integration with ClinicalTrials.gov, EU CTR, WHO ICTRP.
Runs parallel queries and merges results.
"""

import asyncio
import logging

from app.integrations.clinicaltrials_gov import ClinicalTrialsClient
from app.integrations.eu_ctr import EUCTRClient
from app.integrations.who_ictrp import WHOICTRPClient
from app.orchestrator.schemas import NormalizedTerms

logger = logging.getLogger(__name__)


class ClinicalTrialsAgent:
    """A2 agent — search clinical trial registries."""

    def __init__(self):
        self.ct_gov = ClinicalTrialsClient()
        self.eu_ctr = EUCTRClient()
        self.who = WHOICTRPClient()

    async def search(
        self,
        terms: NormalizedTerms,
        age_group: str = "any",
        geography: str = "worldwide",
        study_type: str = "all",
        max_results: int = 20,
    ) -> list[dict]:
        """Search all registries in parallel and merge results."""
        query = terms.search_queries.get("clinicaltrials", terms.english_primary)

        # Parallel queries to all registries
        ct_gov_task = self.ct_gov.search(
            query=query,
            age_group=age_group,
            geography=geography,
            study_type=study_type,
            max_results=max_results,
        )
        eu_ctr_task = self.eu_ctr.search(query=terms.english_primary, max_results=10)
        who_task = self.who.search(query=terms.english_primary, max_results=10)

        results = await asyncio.gather(ct_gov_task, eu_ctr_task, who_task, return_exceptions=True)

        # Collect results, skip errors
        all_trials = []
        for i, result in enumerate(results):
            source = ["ClinicalTrials.gov", "EU CTR", "WHO ICTRP"][i]
            if isinstance(result, Exception):
                logger.warning("A2 %s failed | %s", source, str(result)[:100])
                continue
            if isinstance(result, list):
                all_trials.extend(result)
                logger.info("A2 %s | %d results", source, len(result))

        # Deduplicate by NCT ID (or trial_id for EU CTR)
        deduped = self._deduplicate(all_trials)
        logger.info("A2 total | raw=%d deduped=%d", len(all_trials), len(deduped))
        return deduped

    def _deduplicate(self, trials: list[dict]) -> list[dict]:
        """Remove duplicate trials by NCT ID."""
        seen = set()
        unique = []
        for trial in trials:
            trial_id = trial.get("nct_id") or trial.get("trial_id") or ""
            if not trial_id or trial_id in seen:
                continue
            seen.add(trial_id)
            unique.append(trial)
        return unique
