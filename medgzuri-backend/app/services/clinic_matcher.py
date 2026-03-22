"""Smart clinic matching — ranks clinics by specialty, price, proximity, and quality.

Uses the structured clinic database to provide instant results without LLM calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.data.clinics_database import (
    ALL_CLINICS,
    CLINICS_BY_COUNTRY,
    ClinicEntry,
    get_matching_specialties,
)
from app.services.price_estimator import (
    estimate_total_trip,
    estimate_travel_cost,
)

logger = logging.getLogger(__name__)


# Country proximity score from Georgia (higher = closer/easier to reach)
PROXIMITY_FROM_GEORGIA: dict[str, float] = {
    "georgia": 1.0,
    "turkey": 0.9,
    "israel": 0.6,
    "germany": 0.5,
    "united states": 0.2,
}


@dataclass
class MatchedClinic:
    """A clinic matched to a patient query with scoring breakdown."""
    clinic: ClinicEntry
    match_score: float = 0.0
    specialty_match: float = 0.0
    price_score: float = 0.0
    proximity_score: float = 0.0
    quality_score: float = 0.0
    language_score: float = 0.0
    recommended_for_georgians: bool = False
    estimated_total_cost: dict[str, str] = field(default_factory=dict)
    matching_specialties: list[str] = field(default_factory=list)


def match_clinics(
    diagnosis: str,
    country_preference: list[str] | None = None,
    budget: str = "no_preference",
) -> list[MatchedClinic]:
    """Match clinics to a diagnosis, ranked by composite score.

    Args:
        diagnosis: English diagnosis or treatment name
        country_preference: preferred countries (empty = all)
        budget: "low", "medium", "high", or "no_preference"

    Returns:
        Ranked list of matched clinics
    """
    target_specialties = get_matching_specialties(diagnosis)
    logger.info("Matching clinics | diagnosis=%s | specialties=%s", diagnosis, target_specialties)

    # Filter by country preference if specified
    candidates = _get_candidates(country_preference)

    matched: list[MatchedClinic] = []
    for clinic in candidates:
        result = _score_clinic(clinic, target_specialties, budget, diagnosis)
        if result.match_score > 0:
            matched.append(result)

    # Sort by match score descending
    matched.sort(key=lambda m: m.match_score, reverse=True)
    logger.info("Matched %d clinics for '%s'", len(matched), diagnosis)
    return matched


def match_by_diagnosis(diagnosis: str) -> list[MatchedClinic]:
    """Simple match by diagnosis across all countries."""
    return match_clinics(diagnosis)


def compare_clinics(clinic_names: list[str]) -> list[dict]:
    """Build a comparison table for specific clinics by name.

    Returns list of dicts with standardized comparison fields.
    """
    results = []
    for name in clinic_names:
        clinic = _find_clinic_by_name(name)
        if not clinic:
            continue

        travel = estimate_travel_cost("Georgia", clinic.country)
        results.append({
            "name_en": clinic.name_en,
            "name_ka": clinic.name_ka,
            "country": clinic.country_ka,
            "city": clinic.city_ka,
            "specialties": clinic.specialties,
            "quality": ", ".join(clinic.quality_indicators),
            "languages": ", ".join(clinic.languages),
            "flight_cost": travel.get("flight_cost", "N/A"),
            "accommodation_per_day": travel.get("accommodation_per_day", "N/A"),
            "visa_required": travel.get("visa_required", True),
            "recommended_for_georgians": clinic.recommended_for_georgians,
            "prices": clinic.approximate_prices,
        })

    return results


def estimate_total_cost_for_clinic(
    clinic_name: str,
    treatment: str,
    origin: str = "Georgia",
) -> dict:
    """Estimate total cost for a specific clinic and treatment.

    Returns dict with treatment_cost, travel_cost, accommodation, total_estimate.
    """
    clinic = _find_clinic_by_name(clinic_name)
    if not clinic:
        return {"error": f"Clinic '{clinic_name}' not found in database"}

    return estimate_total_trip(treatment, clinic.country, clinic.approximate_prices)


# ═══════════════ INTERNAL HELPERS ═══════════════


def _get_candidates(country_preference: list[str] | None) -> list[ClinicEntry]:
    """Get candidate clinics filtered by country preference."""
    if not country_preference:
        return ALL_CLINICS

    candidates = []
    for pref in country_preference:
        pref_lower = pref.lower().strip()
        # Try direct match and common aliases
        for key in [pref_lower, _normalize_country(pref_lower)]:
            if key in CLINICS_BY_COUNTRY:
                candidates.extend(CLINICS_BY_COUNTRY[key])
                break

    # If no matches found for preferences, fall back to all
    return candidates if candidates else ALL_CLINICS


def _normalize_country(name: str) -> str:
    """Normalize common country name variants."""
    aliases = {
        "usa": "united states",
        "us": "united states",
        "america": "united states",
        "türkiye": "turkey",
        "turkiye": "turkey",
        "საქართველო": "georgia",
        "თურქეთი": "turkey",
        "ისრაელი": "israel",
        "გერმანია": "germany",
        "აშშ": "united states",
    }
    return aliases.get(name, name)


def _score_clinic(
    clinic: ClinicEntry,
    target_specialties: list[str],
    budget: str,
    diagnosis: str,
) -> MatchedClinic:
    """Score a clinic against the query criteria."""
    # Specialty match (0-40 points)
    clinic_specs = set(clinic.specialties)
    target_specs = set(target_specialties)
    overlap = clinic_specs & target_specs
    specialty_score = min(len(overlap) * 15, 40) if overlap else 0.0

    # For multi_specialty clinics that don't have exact match, give partial credit
    if not overlap and "multi_specialty" in clinic_specs:
        specialty_score = 10.0

    matching_specs = list(overlap)

    # Price score (0-20 points) — lower cost = higher score for budget-conscious
    price_score = _calculate_price_score(clinic, budget)

    # Proximity from Georgia (0-20 points)
    country_lower = clinic.country.lower()
    proximity = PROXIMITY_FROM_GEORGIA.get(country_lower, 0.3)
    proximity_score = proximity * 20

    # Quality indicators (0-15 points)
    quality_score = _calculate_quality_score(clinic)

    # Language support for Georgian patients (0-5 points)
    lang_score = 0.0
    languages_lower = [l.lower() for l in clinic.languages]
    if "georgian" in languages_lower:
        lang_score = 5.0
    elif "russian" in languages_lower:
        lang_score = 3.0
    elif "english" in languages_lower:
        lang_score = 2.0

    total = specialty_score + price_score + proximity_score + quality_score + lang_score

    # Build estimated cost info
    trip_cost = estimate_total_trip(diagnosis, clinic.country, clinic.approximate_prices)

    return MatchedClinic(
        clinic=clinic,
        match_score=round(total, 1),
        specialty_match=specialty_score,
        price_score=price_score,
        proximity_score=proximity_score,
        quality_score=quality_score,
        language_score=lang_score,
        recommended_for_georgians=clinic.recommended_for_georgians,
        estimated_total_cost=trip_cost,
        matching_specialties=matching_specs,
    )


def _calculate_price_score(clinic: ClinicEntry, budget: str) -> float:
    """Score based on affordability. Higher score = better value."""
    country_lower = clinic.country.lower()
    # Country-level cost tiers
    cost_tiers = {
        "georgia": 5,      # cheapest
        "turkey": 4,
        "india": 4,
        "israel": 2,
        "germany": 1,
        "united states": 0,  # most expensive
    }
    tier = cost_tiers.get(country_lower, 2)

    if budget == "low":
        return tier * 4  # max 20 for cheapest
    elif budget == "high":
        # For high budget, quality matters more — invert slightly
        return max(20 - tier * 2, 5)
    else:
        # Medium or no preference: moderate scoring
        return tier * 2.5


def _calculate_quality_score(clinic: ClinicEntry) -> float:
    """Score based on quality indicators."""
    score = 0.0
    indicators = " ".join(clinic.quality_indicators).lower()

    if "jci" in indicators:
        score += 5
    if "university" in indicators or "academic" in indicators:
        score += 3
    if "#1" in indicators or "top" in indicators:
        score += 4
    if "research" in indicators:
        score += 2
    if "nobel" in indicators:
        score += 1

    return min(score, 15)


def _find_clinic_by_name(name: str) -> ClinicEntry | None:
    """Find a clinic by English or Georgian name (case-insensitive)."""
    name_lower = name.lower()
    for clinic in ALL_CLINICS:
        if name_lower in clinic.name_en.lower() or name_lower in clinic.name_ka:
            return clinic
    return None
