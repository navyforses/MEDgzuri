"""C2 — Clinic Finder.

Primary source: Structured clinic database (instant, verified data).
Secondary source: ClinicalTrials.gov (facilities running trials for this condition).
Falls back to LLM search if no database match.
"""

import logging
from typing import Any

from app.data.clinics_database import get_matching_specialties
from app.integrations.clinicaltrials_gov import ClinicalTrialsClient
from app.orchestrator.schemas import ClinicResult
from app.services.clinic_matcher import match_clinics

logger = logging.getLogger(__name__)


class ClinicFinder:
    """C2 agent — find clinics from database + trial registries."""

    def __init__(self):
        self.ct_client = ClinicalTrialsClient()

    async def find(
        self,
        query_data: dict,
        preferred_countries: list[str],
    ) -> list[ClinicResult]:
        """Find clinics: database first, then ClinicalTrials.gov supplement."""
        diagnosis = query_data.get("english_primary", "")

        # Step 1: Match from structured clinic database (instant)
        db_clinics = self._match_from_database(diagnosis, preferred_countries)
        logger.info("C2 database match | clinics=%d", len(db_clinics))

        # Step 2: Supplement with ClinicalTrials.gov
        trial_clinics = await self._find_from_trials(query_data, preferred_countries)
        logger.info("C2 trial match | clinics=%d", len(trial_clinics))

        # Step 3: Merge — database clinics first, then trial clinics (deduped)
        merged = self._merge_results(db_clinics, trial_clinics)
        logger.info("C2 total | clinics=%d", len(merged))
        return merged

    def _match_from_database(
        self,
        diagnosis: str,
        preferred_countries: list[str],
    ) -> list[ClinicResult]:
        """Match clinics from the structured database."""
        if not diagnosis:
            return []

        matched = match_clinics(
            diagnosis=diagnosis,
            country_preference=preferred_countries if preferred_countries else None,
            budget="no_preference",
        )

        results = []
        for m in matched[:15]:
            clinic = m.clinic
            results.append(ClinicResult(
                name=clinic.name_en,
                country=clinic.country,
                city=clinic.city,
                specialization=", ".join(m.matching_specialties) if m.matching_specialties else ", ".join(clinic.specialties[:3]),
                website=clinic.website,
                languages=clinic.languages,
                jci_accredited="jci" in " ".join(clinic.quality_indicators).lower(),
                source_url=clinic.website,
            ))

        return results

    async def _find_from_trials(
        self,
        query_data: dict,
        preferred_countries: list[str],
    ) -> list[ClinicResult]:
        """Find clinics from ClinicalTrials.gov (existing logic)."""
        query = query_data.get("search_queries", {}).get(
            "clinicaltrials", query_data.get("english_primary", "")
        )
        if not query:
            return []

        geography = ",".join(preferred_countries) if preferred_countries else "worldwide"
        try:
            trials = await self.ct_client.search(
                query=query,
                geography=geography,
                max_results=30,
            )
            return self._extract_facilities(trials)
        except Exception as e:
            logger.warning("C2 ClinicalTrials.gov search failed | %s", str(e)[:200])
            return []

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

        clinics.sort(key=lambda c: c.active_trials_count, reverse=True)
        return clinics[:15]

    def _merge_results(
        self,
        db_clinics: list[ClinicResult],
        trial_clinics: list[ClinicResult],
    ) -> list[ClinicResult]:
        """Merge database and trial results, deduplicating by name similarity."""
        seen_names = {c.name.lower() for c in db_clinics}
        merged = list(db_clinics)

        for tc in trial_clinics:
            tc_lower = tc.name.lower()
            # Skip if already in database results (fuzzy match)
            if any(tc_lower in sn or sn in tc_lower for sn in seen_names if len(sn) > 5):
                # Enrich existing clinic with trial count
                for dc in merged:
                    if tc_lower in dc.name.lower() or dc.name.lower() in tc_lower:
                        dc.active_trials_count += tc.active_trials_count
                        break
                continue

            seen_names.add(tc_lower)
            merged.append(tc)

        return merged[:20]
