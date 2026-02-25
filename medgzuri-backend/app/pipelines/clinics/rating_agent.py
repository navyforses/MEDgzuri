"""C3 — Rating Agent.

Enriches clinics with rating data: JCI accreditation, publication count, rankings.
Uses PubMed to check publication count per facility.
"""

import asyncio
import logging

from app.integrations.pubmed import PubMedClient
from app.orchestrator.schemas import ClinicResult, ClinicWithRating

logger = logging.getLogger(__name__)

# Known JCI-accredited facilities (partial list for top medical tourism destinations)
JCI_ACCREDITED = {
    "memorial": True, "anadolu": True, "acibadem": True,
    "medicana": True, "liv hospital": True,
    "sheba": True, "hadassah": True, "sourasky": True,
    "charité": True, "charite": True, "university hospital heidelberg": True,
    "mayo clinic": True, "johns hopkins": True, "md anderson": True,
    "cleveland clinic": True, "memorial sloan": True,
    "bumrungrad": True, "apollo": True,
}


class ClinicRatingAgent:
    """C3 agent — rate clinics based on accreditation, publications, rankings."""

    def __init__(self):
        self.pubmed = PubMedClient()

    async def rate(
        self,
        clinics: list[ClinicResult],
        condition_query: str,
    ) -> list[ClinicWithRating]:
        """Enrich clinics with rating data."""
        if not clinics:
            return []

        # Check publications for top clinics (limit to 10 to avoid rate limiting)
        tasks = [
            self._rate_single(clinic, condition_query)
            for clinic in clinics[:10]
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        rated = []
        for i, result in enumerate(results):
            if isinstance(result, ClinicWithRating):
                rated.append(result)
            elif isinstance(result, Exception):
                logger.warning("C3 rating failed for %s | %s", clinics[i].name, str(result)[:100])
                rated.append(self._basic_rating(clinics[i]))

        # Add remaining clinics without detailed rating
        for clinic in clinics[10:]:
            rated.append(self._basic_rating(clinic))

        logger.info("C3 rated | clinics=%d", len(rated))
        return rated

    async def _rate_single(
        self,
        clinic: ClinicResult,
        condition: str,
    ) -> ClinicWithRating:
        """Rate a single clinic."""
        # Check JCI
        name_lower = clinic.name.lower()
        jci = any(known in name_lower for known in JCI_ACCREDITED if JCI_ACCREDITED[known])

        # Check PubMed publications
        pub_count = 0
        try:
            query = f'"{clinic.name}"[Affiliation] AND {condition}'
            articles = await self.pubmed.search(query=query, max_results=5, years_back=5)
            pub_count = len(articles)
        except Exception:
            pass

        # Calculate score
        score = self._calculate_score(clinic, jci, pub_count)

        return ClinicWithRating(
            **clinic.model_dump(),
            rating_score=score,
            publication_count=pub_count,
            jci_accredited=jci,
        )

    def _basic_rating(self, clinic: ClinicResult) -> ClinicWithRating:
        """Create basic rating without API calls."""
        name_lower = clinic.name.lower()
        jci = any(known in name_lower for known in JCI_ACCREDITED if JCI_ACCREDITED[known])
        score = 50 + (10 if jci else 0) + min(clinic.active_trials_count * 5, 20)

        return ClinicWithRating(
            **clinic.model_dump(),
            rating_score=min(score, 100),
            jci_accredited=jci,
        )

    def _calculate_score(self, clinic: ClinicResult, jci: bool, pub_count: int) -> float:
        score = 40.0
        if jci:
            score += 15
        score += min(pub_count * 5, 20)
        score += min(clinic.active_trials_count * 5, 25)
        return min(score, 100)
