"""C2 — Clinic Finder.

Primary source: ClinicalTrials.gov (facilities running trials for this condition).
Secondary: Claude Sonnet knowledge for well-known centers.
"""

import logging
from typing import Any

from app.integrations.clinicaltrials_gov import ClinicalTrialsClient
from app.orchestrator.schemas import ClinicResult

logger = logging.getLogger(__name__)


class ClinicFinder:
    """C2 agent — find clinics from trial registries and AI knowledge."""

    def __init__(self):
        self.ct_client = ClinicalTrialsClient()

    async def find(
        self,
        query_data: dict,
        preferred_countries: list[str],
    ) -> list[ClinicResult]:
        """Find clinics based on active trials and known centers."""
        query = query_data.get("search_queries", {}).get(
            "clinicaltrials", query_data.get("english_primary", "")
        )

        # Get trials to find active research facilities
        geography = ",".join(preferred_countries) if preferred_countries else "worldwide"
        trials = await self.ct_client.search(
            query=query,
            geography=geography,
            max_results=30,
        )

        # Extract unique facilities from trial locations
        clinics = self._extract_facilities(trials)
        logger.info("C2 found | clinics=%d from %d trials", len(clinics), len(trials))
        return clinics

    def _extract_facilities(self, trials: list[dict]) -> list[ClinicResult]:
        """Extract unique facilities from trial locations."""
        seen = set()
        clinics = []

        for trial in trials:
            for loc in trial.get("locations", []):
                facility = loc.get("facility", "")
                country = loc.get("country", "")
                if not facility or not country:
                    continue

                key = f"{facility}|{country}"
                if key in seen:
                    # Increment trial count for existing clinic
                    for c in clinics:
                        if c.name == facility and c.country == country:
                            c.active_trials_count += 1
                            break
                    continue

                seen.add(key)
                clinics.append(ClinicResult(
                    name=facility,
                    country=country,
                    city=loc.get("city", ""),
                    contact_email=loc.get("contact_email", ""),
                    active_trials_count=1,
                    source_url=trial.get("url", ""),
                ))

        # Sort by trial count (more trials = more expertise)
        clinics.sort(key=lambda c: c.active_trials_count, reverse=True)
        return clinics[:20]
