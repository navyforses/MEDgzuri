"""ClinicalTrials.gov REST API v2 integration.

Docs: https://clinicaltrials.gov/data-api/api
Endpoint: https://clinicaltrials.gov/api/v2/studies
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"

# Geography mapping for location filters
GEOGRAPHY_MAP = {
    "usa": "United States",
    "turkey": "Türkiye",
    "israel": "Israel",
    "germany": "Germany",
    "spain": "Spain",
    "india": "India",
    "japan": "Japan",
}

EU_COUNTRIES = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
    "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
    "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta",
    "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
    "Spain", "Sweden",
]


class ClinicalTrialsClient:
    """Async client for ClinicalTrials.gov API v2."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search(
        self,
        query: str,
        age_group: str = "any",
        geography: str = "worldwide",
        study_type: str = "all",
        status: str = "recruiting",
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """Search for clinical trials and return structured results."""
        params = self._build_params(query, age_group, geography, study_type, status, max_results)

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(BASE_URL, params=params)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if response.status_code != 200:
                    logger.warning(
                        "ClinicalTrials.gov | status=%d | %dms | query=%s",
                        response.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = response.json()
                studies = data.get("studies", [])
                logger.info(
                    "ClinicalTrials.gov OK | results=%d | %dms | query=%s",
                    len(studies), elapsed_ms, query[:80],
                )
                return [self._parse_study(s) for s in studies]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("ClinicalTrials.gov timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("ClinicalTrials.gov error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    def _build_params(
        self, query: str, age_group: str, geography: str,
        study_type: str, status: str, max_results: int,
    ) -> dict[str, str]:
        params: dict[str, str] = {
            "query.cond": query,
            "pageSize": str(min(max_results, 50)),
            "format": "json",
            "fields": (
                "NCTId,BriefTitle,OfficialTitle,OverallStatus,Phase,"
                "Condition,InterventionName,InterventionType,"
                "LocationCountry,LocationCity,LocationFacility,"
                "LocationContactName,LocationContactEMail,"
                "EligibilityCriteria,MinimumAge,MaximumAge,Gender,"
                "StartDate,CompletionDate,LeadSponsorName,"
                "EnrollmentCount,StudyType"
            ),
        }

        # Status filter
        status_map = {
            "recruiting": "RECRUITING,NOT_YET_RECRUITING",
            "all": "RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING,COMPLETED",
            "completed": "COMPLETED",
        }
        params["filter.overallStatus"] = status_map.get(status, status_map["recruiting"])

        # Geography filter
        location_filter = self._build_location_filter(geography)
        if location_filter:
            params["query.locn"] = location_filter

        # Study type filter
        if study_type and study_type != "all":
            type_map = {
                "interventional": "INTERVENTIONAL",
                "observational": "OBSERVATIONAL",
                "expanded_access": "EXPANDED_ACCESS",
            }
            if study_type in type_map:
                params["filter.studyType"] = type_map[study_type]

        return params

    def _build_location_filter(self, geography: str) -> str:
        if not geography or geography == "worldwide":
            return ""

        countries = []
        for geo in geography.split(","):
            geo = geo.strip().lower()
            if geo == "europe" or geo == "eu":
                countries.extend(EU_COUNTRIES)
            elif geo in GEOGRAPHY_MAP:
                countries.append(GEOGRAPHY_MAP[geo])
            elif geo == "worldwide":
                return ""

        if countries:
            return ",".join(set(countries))
        return ""

    def _parse_study(self, study: dict) -> dict[str, Any]:
        """Parse API v2 study response into our standard format."""
        proto = study.get("protocolSection", {})
        ident = proto.get("identificationModule", {})
        status_mod = proto.get("statusModule", {})
        design = proto.get("designModule", {})
        eligibility = proto.get("eligibilityModule", {})
        contacts = proto.get("contactsLocationsModule", {})
        sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
        arms = proto.get("armsInterventionsModule", {})

        nct_id = ident.get("nctId", "")

        # Parse locations
        locations = []
        for loc in contacts.get("locations", []):
            locations.append({
                "country": loc.get("country", ""),
                "city": loc.get("city", ""),
                "facility": loc.get("facility", ""),
                "contact_name": _nested_get(loc, "contacts", 0, "name"),
                "contact_email": _nested_get(loc, "contacts", 0, "email"),
            })

        # Parse interventions
        interventions = []
        for arm in arms.get("interventions", []):
            interventions.append({
                "type": arm.get("type", ""),
                "name": arm.get("name", ""),
            })

        return {
            "nct_id": nct_id,
            "title": ident.get("briefTitle", ident.get("officialTitle", "")),
            "phase": _join_list(design.get("phases", [])),
            "status": status_mod.get("overallStatus", ""),
            "conditions": proto.get("conditionsModule", {}).get("conditions", []),
            "interventions": interventions,
            "locations": locations,
            "eligibility": {
                "min_age": eligibility.get("minimumAge", "N/A"),
                "max_age": eligibility.get("maximumAge", "N/A"),
                "sex": eligibility.get("sex", "All"),
            },
            "dates": {
                "start": status_mod.get("startDateStruct", {}).get("date", ""),
                "estimated_completion": status_mod.get("completionDateStruct", {}).get("date", ""),
            },
            "sponsor": _nested_get(sponsor_mod, "leadSponsor", "name"),
            "enrollment": design.get("enrollmentInfo", {}).get("count"),
            "source_registry": "ClinicalTrials.gov",
            "url": f"https://clinicaltrials.gov/study/{nct_id}",
        }


def _nested_get(obj: Any, *keys: Any) -> str:
    """Safely traverse nested dicts/lists."""
    current = obj
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key, {})
        elif isinstance(current, list) and isinstance(key, int) and key < len(current):
            current = current[key]
        else:
            return ""
    return str(current) if current else ""


def _join_list(items: list) -> str:
    return ", ".join(str(i) for i in items) if items else ""
