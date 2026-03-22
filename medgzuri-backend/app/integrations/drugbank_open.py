"""OpenFDA Drug API integration — drug labels, adverse events, enforcement.

Docs: https://open.fda.gov/apis/drug/
Base URL: https://api.fda.gov/drug
No API key required (rate limit: 240 req/min without key).
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.fda.gov/drug"


class OpenFDAClient:
    """Async client for OpenFDA Drug API."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search_drug(
        self,
        name: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Search drug labels by name. Returns generic name, brand names,
        indications, warnings, and interactions."""
        # Search in both generic and brand name fields
        search_query = (
            f'(openfda.generic_name:"{name}"'
            f'+openfda.brand_name:"{name}")'
        )
        params = {
            "search": search_query,
            "limit": str(min(limit, 25)),
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/label.json", params=params,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenFDA search_drug | status=%d | %dms | name=%s",
                        resp.status_code, elapsed_ms, name[:80],
                    )
                    return []

                data = resp.json()
                results = data.get("results", [])
                logger.info(
                    "OpenFDA search_drug OK | results=%d | %dms | name=%s",
                    len(results), elapsed_ms, name[:80],
                )
                return [self._parse_label(r) for r in results]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("OpenFDA search_drug timeout | %dms | name=%s", elapsed_ms, name[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenFDA search_drug error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    async def search_adverse_events(
        self,
        drug_name: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Search adverse event reports for a drug."""
        search_query = f'patient.drug.medicinalproduct:"{drug_name}"'
        params = {
            "search": search_query,
            "limit": str(min(limit, 25)),
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/event.json", params=params,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenFDA adverse_events | status=%d | %dms | drug=%s",
                        resp.status_code, elapsed_ms, drug_name[:80],
                    )
                    return []

                data = resp.json()
                results = data.get("results", [])
                logger.info(
                    "OpenFDA adverse_events OK | results=%d | %dms | drug=%s",
                    len(results), elapsed_ms, drug_name[:80],
                )
                return [self._parse_adverse_event(r) for r in results]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "OpenFDA adverse_events timeout | %dms | drug=%s", elapsed_ms, drug_name[:80],
            )
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenFDA adverse_events error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    async def search_drug_labels(
        self,
        query: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Free-text search across drug labels (indications, warnings, etc.)."""
        params = {
            "search": query,
            "limit": str(min(limit, 25)),
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{BASE_URL}/label.json", params=params,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.warning(
                        "OpenFDA search_labels | status=%d | %dms | query=%s",
                        resp.status_code, elapsed_ms, query[:80],
                    )
                    return []

                data = resp.json()
                results = data.get("results", [])
                logger.info(
                    "OpenFDA search_labels OK | results=%d | %dms | query=%s",
                    len(results), elapsed_ms, query[:80],
                )
                return [self._parse_label(r) for r in results]

        except httpx.TimeoutException:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("OpenFDA search_labels timeout | %dms | query=%s", elapsed_ms, query[:80])
            return []
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("OpenFDA search_labels error | %dms | %s", elapsed_ms, str(e)[:200])
            return []

    # ═══════════════ PARSING ═══════════════

    def _parse_label(self, r: dict) -> dict[str, Any]:
        """Parse an OpenFDA drug label result."""
        openfda = r.get("openfda", {})

        generic_names = openfda.get("generic_name", [])
        brand_names = openfda.get("brand_name", [])
        manufacturer = openfda.get("manufacturer_name", [])
        substance = openfda.get("substance_name", [])
        route = openfda.get("route", [])
        pharm_class = openfda.get("pharm_class_epc", [])

        # Text fields — OpenFDA returns arrays of strings
        indications = _join_field(r.get("indications_and_usage", []))
        warnings = _join_field(r.get("warnings", []))
        interactions = _join_field(r.get("drug_interactions", []))
        contraindications = _join_field(r.get("contraindications", []))
        adverse_reactions = _join_field(r.get("adverse_reactions", []))
        dosage = _join_field(r.get("dosage_and_administration", []))
        boxed_warning = _join_field(r.get("boxed_warning", []))

        return {
            "generic_name": generic_names[0] if generic_names else "",
            "brand_names": brand_names,
            "manufacturer": manufacturer[0] if manufacturer else "",
            "substance_name": substance,
            "route": route,
            "pharmacologic_class": pharm_class,
            "indications": indications[:2000],
            "warnings": warnings[:2000],
            "boxed_warning": boxed_warning[:1000],
            "drug_interactions": interactions[:2000],
            "contraindications": contraindications[:1500],
            "adverse_reactions": adverse_reactions[:2000],
            "dosage": dosage[:1500],
            "source": "OpenFDA",
        }

    def _parse_adverse_event(self, r: dict) -> dict[str, Any]:
        """Parse an OpenFDA adverse event report."""
        patient = r.get("patient", {})
        drugs = patient.get("drug", [])
        reactions = patient.get("reaction", [])

        # Extract drug names
        drug_names = []
        for d in drugs:
            name = d.get("medicinalproduct", "")
            if name:
                drug_names.append({
                    "name": name,
                    "indication": d.get("drugindication", ""),
                    "characterization": d.get("drugcharacterization", ""),
                })

        # Extract reactions
        reaction_list = []
        for rx in reactions:
            term = rx.get("reactionmeddrapt", "")
            outcome = rx.get("reactionoutcome", "")
            if term:
                reaction_list.append({"term": term, "outcome": outcome})

        return {
            "safety_report_id": r.get("safetyreportid", ""),
            "receive_date": r.get("receivedate", ""),
            "serious": r.get("serious", ""),
            "patient_age": patient.get("patientonsetage", ""),
            "patient_sex": patient.get("patientsex", ""),
            "drugs": drug_names,
            "reactions": reaction_list,
            "source": "OpenFDA",
        }


def _join_field(field: list[str] | str) -> str:
    """Join OpenFDA text field (may be list or string)."""
    if isinstance(field, list):
        return " ".join(field)
    return str(field) if field else ""
