"""Country data for Georgian patients — visa, travel, cost benchmarks."""

COUNTRY_INFO = {
    "germany": {
        "name_ka": "გერმანია",
        "visa_required": True,
        "visa_type": "შენგენი",
        "flight_hours": 4,
        "flight_cost_eur": (200, 400),
        "living_cost_per_day_eur": (80, 150),
        "accessibility_bonus": 10,
        "languages": ["გერმანული", "ინგლისური"],
        "medical_tourism_notes": "ევროპის ერთ-ერთი წამყვანი სამედიცინო მიმართულება",
    },
    "turkey": {
        "name_ka": "თურქეთი",
        "visa_required": False,
        "visa_type": None,
        "flight_hours": 2,
        "flight_cost_eur": (80, 200),
        "living_cost_per_day_eur": (30, 60),
        "accessibility_bonus": 20,
        "languages": ["თურქული", "ინგლისური", "რუსული"],
        "medical_tourism_notes": "უვიზო, ახლოს, ხელმისაწვდომი ფასები",
    },
    "israel": {
        "name_ka": "ისრაელი",
        "visa_required": True,
        "visa_type": "ტურისტული",
        "flight_hours": 3,
        "flight_cost_eur": (150, 350),
        "living_cost_per_day_eur": (100, 180),
        "accessibility_bonus": 15,
        "languages": ["ებრაული", "ინგლისური", "რუსული"],
        "medical_tourism_notes": "მაღალი დონის სამედიცინო ტურიზმი",
    },
    "usa": {
        "name_ka": "ამერიკის შეერთებული შტატები",
        "visa_required": True,
        "visa_type": "B1/B2",
        "flight_hours": 12,
        "flight_cost_eur": (500, 1200),
        "living_cost_per_day_eur": (120, 250),
        "accessibility_bonus": 5,
        "languages": ["ინგლისური"],
        "medical_tourism_notes": "ვიზის სირთულე, მაღალი ხარჯი, საუკეთესო ცენტრები",
    },
    "spain": {
        "name_ka": "ესპანეთი",
        "visa_required": True,
        "visa_type": "შენგენი",
        "flight_hours": 5,
        "flight_cost_eur": (150, 350),
        "living_cost_per_day_eur": (60, 120),
        "accessibility_bonus": 8,
        "languages": ["ესპანური", "ინგლისური"],
        "medical_tourism_notes": "კარგი სამედიცინო ინფრასტრუქტურა",
    },
    "india": {
        "name_ka": "ინდოეთი",
        "visa_required": True,
        "visa_type": "e-Visa",
        "flight_hours": 7,
        "flight_cost_eur": (300, 600),
        "living_cost_per_day_eur": (20, 50),
        "accessibility_bonus": 5,
        "languages": ["ინგლისური", "ჰინდი"],
        "medical_tourism_notes": "ძალიან ხელმისაწვდომი ფასები",
    },
    "japan": {
        "name_ka": "იაპონია",
        "visa_required": True,
        "visa_type": "ტურისტული",
        "flight_hours": 12,
        "flight_cost_eur": (500, 1000),
        "living_cost_per_day_eur": (100, 200),
        "accessibility_bonus": 3,
        "languages": ["იაპონური", "ინგლისური"],
        "medical_tourism_notes": "მაღალი ტექნოლოგიები, ენობრივი ბარიერი",
    },
}


def get_country_info(country: str) -> dict:
    """Get country info by name (case-insensitive)."""
    key = country.lower().strip()
    # Handle common aliases
    aliases = {"türkiye": "turkey", "united states": "usa", "us": "usa"}
    key = aliases.get(key, key)
    return COUNTRY_INFO.get(key, {})
