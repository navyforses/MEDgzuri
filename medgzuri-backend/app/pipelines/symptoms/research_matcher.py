"""B3 — Research Matcher.

For each research direction from B2, searches relevant clinical trials
using Pipeline A components (A1 → A2 + A3 → A4).
"""

import asyncio
import logging

from app.orchestrator.schemas import ResearchInput
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.term_normalizer import TermNormalizer

logger = logging.getLogger(__name__)


class ResearchMatcher:
    """B3 agent — match research directions to active clinical trials."""

    def __init__(self):
        self.normalizer = TermNormalizer()
        self.trials_agent = ClinicalTrialsAgent()
        self.literature_agent = LiteratureSearchAgent()
        self.aggregator = ResearchAggregator()

    async def match(
        self,
        directions: list[dict],
        patient_age: int | None = None,
        patient_sex: str = "",
    ) -> dict[str, list[dict]]:
        """For each research direction, find matching trials.

        Returns: {"condition_name": [scored_results, ...]}
        """
        if not directions:
            return {}

        # Limit to top 3 directions to avoid excessive API calls
        top_directions = directions[:3]

        tasks = [
            self._match_direction(d, patient_age, patient_sex)
            for d in top_directions
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        matched = {}
        for i, result in enumerate(results):
            condition = top_directions[i].get("condition", f"direction_{i}")
            if isinstance(result, list):
                matched[condition] = result
                logger.info("B3 matched | %s | results=%d", condition[:40], len(result))
            elif isinstance(result, Exception):
                logger.warning("B3 match failed | %s | %s", condition[:40], str(result)[:100])
                matched[condition] = []

        return matched

    async def _match_direction(
        self,
        direction: dict,
        patient_age: int | None,
        patient_sex: str,
    ) -> list[dict]:
        """Search for a single research direction."""
        condition = direction.get("condition", "")
        if not condition:
            return []

        # Use A1 to normalize the condition term
        inp = ResearchInput(diagnosis=condition)
        terms = await self.normalizer.normalize(inp)

        # A2: Search trials
        trials = await self.trials_agent.search(
            terms=terms,
            max_results=10,
        )

        # A3: Search literature (limited)
        literature = await self.literature_agent.search(
            terms=terms,
            max_results=5,
            original_query=condition,
        )

        # A4: Aggregate
        scored = await self.aggregator.aggregate(
            trials=trials,
            literature=literature,
            original_query=condition,
        )

        return scored[:5]  # Top 5 per direction
