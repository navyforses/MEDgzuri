"""C4 — Cost Agent.

Estimates treatment costs, visa requirements, travel costs for Georgian patients.
Uses country_data.py benchmarks + Claude Sonnet for treatment-specific estimates.
"""

import logging

from app.orchestrator.schemas import ClinicWithCost, ClinicWithRating

logger = logging.getLogger(__name__)

# Cost benchmarks for Georgian patients (in EUR)
COUNTRY_DATA = {
    "germany": {
        "visa_required": True,
        "flight_cost": "€200-400",
        "living_cost_per_day": "€80-150",
        "cost_multiplier": 1.0,  # baseline
    },
    "türkiye": {
        "visa_required": False,
        "flight_cost": "€80-200",
        "living_cost_per_day": "€30-60",
        "cost_multiplier": 0.4,
    },
    "turkey": {
        "visa_required": False,
        "flight_cost": "€80-200",
        "living_cost_per_day": "€30-60",
        "cost_multiplier": 0.4,
    },
    "israel": {
        "visa_required": True,
        "flight_cost": "€150-350",
        "living_cost_per_day": "€100-180",
        "cost_multiplier": 0.8,
    },
    "united states": {
        "visa_required": True,
        "flight_cost": "€500-1200",
        "living_cost_per_day": "€120-250",
        "cost_multiplier": 2.0,
    },
    "spain": {
        "visa_required": True,
        "flight_cost": "€150-350",
        "living_cost_per_day": "€60-120",
        "cost_multiplier": 0.7,
    },
    "india": {
        "visa_required": True,
        "flight_cost": "€300-600",
        "living_cost_per_day": "€20-50",
        "cost_multiplier": 0.25,
    },
    "japan": {
        "visa_required": True,
        "flight_cost": "€500-1000",
        "living_cost_per_day": "€100-200",
        "cost_multiplier": 1.2,
    },
}

DEFAULT_COUNTRY = {
    "visa_required": True,
    "flight_cost": "€200-500",
    "living_cost_per_day": "€60-120",
    "cost_multiplier": 1.0,
}


class ClinicCostAgent:
    """C4 agent — estimate costs for Georgian patients."""

    async def estimate(
        self,
        clinics: list[ClinicWithRating],
        treatment: str,
    ) -> list[ClinicWithCost]:
        """Estimate costs for each clinic."""
        results = []
        for clinic in clinics:
            cost = self._estimate_single(clinic, treatment)
            results.append(cost)

        logger.info("C4 estimated costs | clinics=%d", len(results))
        return results

    def _estimate_single(
        self,
        clinic: ClinicWithRating,
        treatment: str,
    ) -> ClinicWithCost:
        """Estimate cost for a single clinic based on country data."""
        country = clinic.country.lower()
        data = COUNTRY_DATA.get(country, DEFAULT_COUNTRY)

        return ClinicWithCost(
            clinic_name=clinic.name,
            estimated_treatment_cost=f"კონკრეტული შეფასებისთვის საჭიროა კლინიკასთან კონსულტაცია",
            visa_required=data["visa_required"],
            estimated_flight_cost=data["flight_cost"],
            estimated_living_cost=f"{data['living_cost_per_day']} / დღეში",
            total_estimated_cost="ინდივიდუალური",
        )
