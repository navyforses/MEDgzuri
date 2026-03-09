"""C4 — Cost Agent.

Estimates treatment costs, visa requirements, travel costs for Georgian patients.
Uses structured price_estimator + clinic_database for real cost data.
"""

import logging

from app.data.clinics_database import ALL_CLINICS
from app.orchestrator.schemas import ClinicWithCost, ClinicWithRating
from app.services.price_estimator import estimate_total_trip, estimate_travel_cost

logger = logging.getLogger(__name__)


class ClinicCostAgent:
    """C4 agent — estimate costs for Georgian patients using real price data."""

    def __init__(self):
        # Build a lookup of clinic-specific prices from the database
        self._clinic_prices: dict[str, dict[str, str]] = {}
        for clinic in ALL_CLINICS:
            self._clinic_prices[clinic.name_en.lower()] = clinic.approximate_prices

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
        """Estimate cost for a single clinic using real price data."""
        # Try to find clinic-specific prices
        clinic_prices = self._clinic_prices.get(clinic.name.lower())

        # Get comprehensive cost breakdown
        trip = estimate_total_trip(treatment, clinic.country, clinic_prices)
        travel = estimate_travel_cost("Georgia", clinic.country)

        return ClinicWithCost(
            clinic_name=clinic.name,
            estimated_treatment_cost=trip.get("treatment_cost", "მოითხოვეთ კლინიკაში"),
            visa_required=travel.get("visa_required", True),
            estimated_flight_cost=trip.get("flight_cost", "N/A"),
            estimated_living_cost=trip.get("accommodation", "N/A"),
            total_estimated_cost=trip.get("total_estimate", "ინდივიდუალური"),
        )
