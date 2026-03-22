"""Price estimation for medical tourism from Georgia.

Provides treatment cost ranges, travel costs, accommodation estimates,
and total trip cost calculations.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


# ═══════════════ PROCEDURE COST BENCHMARKS BY COUNTRY (USD) ═══════════════
# Sources: medical tourism industry reports, hospital price lists (2024-2026)

PROCEDURE_COSTS: dict[str, dict[str, tuple[int, int]]] = {
    "georgia": {
        "hip_replacement": (5_000, 8_000),
        "knee_replacement": (4_500, 7_000),
        "cabg_bypass": (8_000, 15_000),
        "heart_valve": (10_000, 18_000),
        "cancer_surgery": (3_000, 12_000),
        "chemotherapy_cycle": (500, 2_000),
        "radiation_course": (3_000, 8_000),
        "brain_surgery": (8_000, 20_000),
        "spine_surgery": (5_000, 12_000),
        "ivf_cycle": (2_500, 4_000),
        "lasik": (800, 1_500),
        "dental_implant": (400, 800),
        "liver_transplant": (25_000, 45_000),
        "kidney_transplant": (15_000, 25_000),
        "pet_ct": (600, 900),
        "mri": (150, 300),
        "colonoscopy": (250, 450),
        "gastric_bypass": (4_000, 7_000),
        "rhinoplasty": (1_500, 3_000),
        "cataract_surgery": (600, 1_200),
    },
    "turkey": {
        "hip_replacement": (7_000, 12_000),
        "knee_replacement": (6_500, 11_000),
        "cabg_bypass": (10_000, 18_000),
        "heart_valve": (12_000, 22_000),
        "cancer_surgery": (7_000, 25_000),
        "chemotherapy_cycle": (1_000, 3_500),
        "radiation_course": (5_000, 12_000),
        "brain_surgery": (12_000, 30_000),
        "spine_surgery": (6_000, 15_000),
        "ivf_cycle": (3_000, 5_000),
        "lasik": (1_000, 2_000),
        "dental_implant": (500, 900),
        "liver_transplant": (55_000, 90_000),
        "kidney_transplant": (18_000, 35_000),
        "bone_marrow_transplant": (50_000, 80_000),
        "pet_ct": (700, 1_200),
        "mri": (200, 400),
        "gastric_bypass": (5_000, 8_000),
        "gastric_sleeve": (4_000, 6_500),
        "rhinoplasty": (2_500, 5_000),
        "cataract_surgery": (1_500, 2_500),
        "robotic_surgery": (8_000, 20_000),
    },
    "israel": {
        "hip_replacement": (15_000, 25_000),
        "knee_replacement": (15_000, 22_000),
        "cabg_bypass": (25_000, 40_000),
        "heart_valve": (30_000, 50_000),
        "cancer_surgery": (15_000, 45_000),
        "chemotherapy_cycle": (3_000, 8_000),
        "radiation_course": (10_000, 25_000),
        "brain_surgery": (30_000, 60_000),
        "spine_surgery": (15_000, 30_000),
        "ivf_cycle": (4_500, 8_000),
        "liver_transplant": (120_000, 200_000),
        "kidney_transplant": (60_000, 100_000),
        "bone_marrow_transplant": (100_000, 150_000),
        "pet_ct": (1_500, 2_500),
        "mri": (500, 1_000),
        "gastric_sleeve": (12_000, 18_000),
        "robotic_surgery": (15_000, 30_000),
        "diagnostic_workup": (3_000, 5_000),
    },
    "germany": {
        "hip_replacement": (18_000, 28_000),
        "knee_replacement": (16_000, 25_000),
        "cabg_bypass": (22_000, 40_000),
        "heart_valve": (25_000, 45_000),
        "cancer_surgery": (20_000, 60_000),
        "chemotherapy_cycle": (4_000, 10_000),
        "radiation_course": (15_000, 30_000),
        "proton_therapy": (25_000, 60_000),
        "brain_surgery": (35_000, 70_000),
        "spine_surgery": (18_000, 35_000),
        "liver_transplant": (130_000, 250_000),
        "kidney_transplant": (50_000, 80_000),
        "bone_marrow_transplant": (100_000, 180_000),
        "pet_ct": (1_500, 3_000),
        "mri": (400, 800),
        "stem_cell_therapy": (30_000, 60_000),
    },
    "united states": {
        "hip_replacement": (25_000, 50_000),
        "knee_replacement": (25_000, 45_000),
        "cabg_bypass": (60_000, 120_000),
        "heart_valve": (70_000, 130_000),
        "cancer_surgery": (40_000, 150_000),
        "chemotherapy_cycle": (5_000, 15_000),
        "radiation_course": (20_000, 50_000),
        "proton_therapy": (50_000, 100_000),
        "brain_surgery": (50_000, 150_000),
        "spine_surgery": (30_000, 80_000),
        "ivf_cycle": (12_000, 20_000),
        "liver_transplant": (300_000, 500_000),
        "kidney_transplant": (100_000, 200_000),
        "bone_marrow_transplant": (200_000, 400_000),
        "pet_ct": (3_000, 6_000),
        "mri": (1_000, 3_000),
        "immunotherapy_cycle": (10_000, 30_000),
    },
}


# ═══════════════ TRAVEL COSTS FROM TBILISI (USD) ═══════════════

TRAVEL_FROM_TBILISI: dict[str, dict] = {
    "georgia": {
        "flight_cost": (0, 0),
        "flight_time": "0h (local)",
        "accommodation_per_day": (30, 80),
        "visa_required": False,
        "visa_cost": 0,
        "typical_stay_days": 1,
    },
    "turkey": {
        "flight_cost": (80, 200),
        "flight_time": "2-3h",
        "accommodation_per_day": (40, 100),
        "visa_required": False,
        "visa_cost": 0,
        "typical_stay_days": 7,
    },
    "israel": {
        "flight_cost": (150, 350),
        "flight_time": "3-4h",
        "accommodation_per_day": (100, 200),
        "visa_required": True,
        "visa_cost": 0,  # Visa-free for Georgian citizens (90 days)
        "typical_stay_days": 10,
    },
    "germany": {
        "flight_cost": (200, 450),
        "flight_time": "4-5h",
        "accommodation_per_day": (80, 180),
        "visa_required": True,
        "visa_cost": 80,
        "typical_stay_days": 10,
    },
    "united states": {
        "flight_cost": (500, 1_200),
        "flight_time": "14-18h",
        "accommodation_per_day": (120, 280),
        "visa_required": True,
        "visa_cost": 185,
        "typical_stay_days": 14,
    },
}

DEFAULT_TRAVEL = {
    "flight_cost": (200, 500),
    "flight_time": "varies",
    "accommodation_per_day": (60, 150),
    "visa_required": True,
    "visa_cost": 80,
    "typical_stay_days": 10,
}


# ═══════════════ PROCEDURE NAME NORMALIZATION ═══════════════

PROCEDURE_ALIASES: dict[str, str] = {
    "hip replacement": "hip_replacement",
    "hip arthroplasty": "hip_replacement",
    "knee replacement": "knee_replacement",
    "knee arthroplasty": "knee_replacement",
    "bypass": "cabg_bypass",
    "cabg": "cabg_bypass",
    "coronary bypass": "cabg_bypass",
    "heart bypass": "cabg_bypass",
    "heart valve": "heart_valve",
    "valve replacement": "heart_valve",
    "cancer surgery": "cancer_surgery",
    "tumor removal": "cancer_surgery",
    "chemotherapy": "chemotherapy_cycle",
    "chemo": "chemotherapy_cycle",
    "radiation": "radiation_course",
    "radiotherapy": "radiation_course",
    "proton therapy": "proton_therapy",
    "brain surgery": "brain_surgery",
    "craniotomy": "brain_surgery",
    "spine surgery": "spine_surgery",
    "spinal surgery": "spine_surgery",
    "back surgery": "spine_surgery",
    "ivf": "ivf_cycle",
    "in vitro": "ivf_cycle",
    "lasik": "lasik",
    "eye surgery": "lasik",
    "dental implant": "dental_implant",
    "liver transplant": "liver_transplant",
    "kidney transplant": "kidney_transplant",
    "bone marrow transplant": "bone_marrow_transplant",
    "bmt": "bone_marrow_transplant",
    "stem cell": "stem_cell_therapy",
    "pet-ct": "pet_ct",
    "pet ct": "pet_ct",
    "mri": "mri",
    "colonoscopy": "colonoscopy",
    "gastric bypass": "gastric_bypass",
    "gastric sleeve": "gastric_sleeve",
    "rhinoplasty": "rhinoplasty",
    "nose job": "rhinoplasty",
    "cataract": "cataract_surgery",
    "robotic surgery": "robotic_surgery",
    "immunotherapy": "immunotherapy_cycle",
    "diagnostic": "diagnostic_workup",
    "checkup": "diagnostic_workup",
}


def _normalize_procedure(procedure: str) -> str:
    """Normalize procedure name to database key."""
    proc_lower = procedure.lower().strip()
    # Direct alias match
    if proc_lower in PROCEDURE_ALIASES:
        return PROCEDURE_ALIASES[proc_lower]
    # Partial match
    for alias, key in PROCEDURE_ALIASES.items():
        if alias in proc_lower:
            return key
    return proc_lower.replace(" ", "_")


# ═══════════════ PUBLIC API ═══════════════


def estimate_procedure_cost(
    procedure: str,
    country: str,
) -> dict:
    """Estimate procedure cost range for a given country.

    Returns dict with low, high (USD), and formatted string.
    """
    country_lower = country.lower().strip()
    proc_key = _normalize_procedure(procedure)

    country_costs = PROCEDURE_COSTS.get(country_lower, {})
    if proc_key in country_costs:
        low, high = country_costs[proc_key]
        return {
            "procedure": procedure,
            "country": country,
            "low_usd": low,
            "high_usd": high,
            "formatted": f"${low:,}-${high:,}",
            "source": "database",
        }

    # Try to find the procedure in the clinic's own price list
    return {
        "procedure": procedure,
        "country": country,
        "low_usd": None,
        "high_usd": None,
        "formatted": "ფასი მოითხოვეთ კლინიკაში",
        "source": "not_available",
    }


def estimate_travel_cost(
    origin: str,
    destination_country: str,
) -> dict:
    """Estimate travel costs from Georgia to destination country.

    Returns flight cost, accommodation, visa info.
    """
    dest_lower = destination_country.lower().strip()
    travel = TRAVEL_FROM_TBILISI.get(dest_lower, DEFAULT_TRAVEL)

    flight_low, flight_high = travel["flight_cost"]
    accom_low, accom_high = travel["accommodation_per_day"]

    return {
        "flight_cost": f"${flight_low}-${flight_high}" if flight_low > 0 else "ადგილობრივი",
        "flight_time": travel["flight_time"],
        "accommodation_per_day": f"${accom_low}-${accom_high}",
        "visa_required": travel["visa_required"],
        "visa_cost": f"${travel['visa_cost']}" if travel["visa_cost"] > 0 else "უფასო",
        "typical_stay_days": travel["typical_stay_days"],
    }


def estimate_total_trip(
    procedure: str,
    country: str,
    clinic_prices: dict[str, str] | None = None,
) -> dict:
    """Estimate total trip cost: treatment + travel + accommodation.

    Args:
        procedure: treatment/procedure name
        country: destination country
        clinic_prices: optional clinic-specific price dict (procedure_name -> "$X-$Y")

    Returns comprehensive cost breakdown.
    """
    # Treatment cost
    treatment = _get_treatment_cost(procedure, country, clinic_prices)

    # Travel costs
    dest_lower = country.lower().strip()
    travel = TRAVEL_FROM_TBILISI.get(dest_lower, DEFAULT_TRAVEL)
    flight_low, flight_high = travel["flight_cost"]
    accom_low, accom_high = travel["accommodation_per_day"]
    stay_days = travel["typical_stay_days"]

    # Calculate totals
    accom_total_low = accom_low * stay_days
    accom_total_high = accom_high * stay_days
    visa = travel.get("visa_cost", 0)

    result = {
        "treatment_cost": treatment["formatted"],
        "flight_cost": f"${flight_low}-${flight_high}" if flight_low > 0 else "ადგილობრივი",
        "accommodation": f"${accom_total_low:,}-${accom_total_high:,} ({stay_days} ღამე)",
        "visa_cost": f"${visa}" if visa > 0 else "არ არის საჭირო" if not travel["visa_required"] else "უფასო",
        "typical_stay_days": stay_days,
    }

    # Total estimate if we have treatment cost
    if treatment.get("low_usd") and treatment.get("high_usd"):
        total_low = treatment["low_usd"] + flight_low + accom_total_low + visa
        total_high = treatment["high_usd"] + flight_high + accom_total_high + visa
        result["total_estimate"] = f"${total_low:,}-${total_high:,}"
        result["total_low_usd"] = total_low
        result["total_high_usd"] = total_high
    else:
        result["total_estimate"] = "მკურნალობის ფასის გარეშე — მოითხოვეთ კლინიკაში"

    return result


def _get_treatment_cost(
    procedure: str,
    country: str,
    clinic_prices: dict[str, str] | None,
) -> dict:
    """Get treatment cost, trying clinic-specific prices first, then country benchmarks."""
    # Try clinic-specific prices
    if clinic_prices:
        proc_lower = procedure.lower()
        for price_name, price_str in clinic_prices.items():
            if proc_lower in price_name.lower() or any(
                kw in price_name.lower() for kw in proc_lower.split()
                if len(kw) > 3
            ):
                parsed = _parse_price_string(price_str)
                if parsed:
                    return {
                        "low_usd": parsed[0],
                        "high_usd": parsed[1],
                        "formatted": price_str,
                        "source": "clinic_specific",
                    }

    # Fall back to country benchmarks
    return estimate_procedure_cost(procedure, country)


def _parse_price_string(price_str: str) -> tuple[int, int] | None:
    """Parse a price string like '$5,000-$10,000' into (5000, 10000)."""
    numbers = re.findall(r"[\d,]+", price_str.replace(",", ""))
    if len(numbers) >= 2:
        try:
            return (int(numbers[0].replace(",", "")), int(numbers[1].replace(",", "")))
        except ValueError:
            pass
    elif len(numbers) == 1:
        try:
            val = int(numbers[0].replace(",", ""))
            return (val, val)
        except ValueError:
            pass
    return None
