"""Personalization service — filter and adapt results to patient profile.

Accepts patient profile (age, sex, existing_conditions, language_preference)
and adjusts results accordingly:
  - Filter by relevance to age group (pediatric, adult, elderly)
  - Adjust reading level: "patient" (simple) vs "professional" (technical)
"""

import logging
from typing import Any

from pydantic import BaseModel, Field

from app.services.llm_client import call_haiku

logger = logging.getLogger(__name__)


# ═══════════════ DATA MODELS ═══════════════

class PatientProfile(BaseModel):
    """Patient profile for personalization."""
    age: int | None = None
    sex: str = ""  # "male", "female", ""
    existing_conditions: list[str] = Field(default_factory=list)
    reading_level: str = "patient"  # "patient" or "professional"


# Age group classification
_AGE_GROUPS = {
    "newborn": (0, 0),
    "infant": (0, 1),
    "pediatric": (0, 17),
    "adult": (18, 64),
    "elderly": (65, 150),
}

# Keywords that indicate age-specific content
_AGE_KEYWORDS = {
    "pediatric": ["pediatric", "paediatric", "child", "infant", "neonatal", "newborn",
                   "პედიატრიული", "ბავშვი", "ჩვილი", "ახალშობილი", "ნეონატალური"],
    "elderly": ["elderly", "geriatric", "older adult", "aging",
                "ხანდაზმული", "გერიატრიული", "მოხუცი"],
}


# ═══════════════ RESULT FILTERING ═══════════════

def personalize_results(
    results: list[dict[str, Any]],
    profile: PatientProfile,
) -> list[dict[str, Any]]:
    """Filter and reorder results based on patient profile.

    - Boosts results matching the patient's age group
    - Deprioritizes (but doesn't remove) irrelevant age-group results
    - If existing_conditions provided, boosts results mentioning them

    Returns reordered list (no items removed, only reordered).
    """
    if not results or not profile:
        return results

    scored: list[tuple[float, int, dict[str, Any]]] = []

    for idx, result in enumerate(results):
        score = 0.0
        text = _get_searchable_text(result)

        # Age relevance scoring
        if profile.age is not None:
            age_group = _classify_age(profile.age)
            if age_group == "pediatric" and _has_age_keywords(text, "pediatric"):
                score += 2.0
            elif age_group == "elderly" and _has_age_keywords(text, "elderly"):
                score += 2.0
            elif age_group == "pediatric" and _has_age_keywords(text, "elderly"):
                score -= 1.0  # Deprioritize elderly content for children
            elif age_group == "elderly" and _has_age_keywords(text, "pediatric"):
                score -= 1.0  # Deprioritize pediatric content for elderly
            elif age_group == "adult":
                # Adults get slight boost for non-age-specific results
                if not _has_age_keywords(text, "pediatric") and not _has_age_keywords(text, "elderly"):
                    score += 0.5

        # Existing conditions relevance
        for condition in profile.existing_conditions:
            if condition.lower() in text:
                score += 1.5

        # Sex relevance
        if profile.sex:
            sex_lower = profile.sex.lower()
            if sex_lower in ("female", "ქალი") and any(kw in text for kw in ["pregnancy", "ორსულობა", "maternal", "დედის"]):
                score += 1.0
            elif sex_lower in ("male", "კაცი") and any(kw in text for kw in ["prostate", "პროსტატა", "testicular"]):
                score += 1.0

        scored.append((score, idx, result))

    # Sort by score (descending), then by original order (ascending)
    scored.sort(key=lambda x: (-x[0], x[1]))

    return [item[2] for item in scored]


# ═══════════════ READING LEVEL ADJUSTMENT ═══════════════

async def adjust_reading_level(text: str, level: str = "patient") -> str:
    """Rewrite text for the target reading level in Georgian.

    Levels:
      - "patient": simple Georgian, avoid jargon, explain medical terms
      - "professional": technical medical Georgian, include terminology

    Returns original text on failure (graceful degradation).
    """
    if not text or level not in ("patient", "professional"):
        return text

    # Don't rewrite very short texts
    if len(text) < 100:
        return text

    if level == "patient":
        system = (
            "გადაწერე ეს სამედიცინო ტექსტი მარტივ, გასაგებ ქართულ ენაზე. "
            "ახსენი სამედიცინო ტერმინები ფრჩხილებში. "
            "გამოიყენე მოკლე წინადადებები. "
            "პასუხი: მხოლოდ გადაწერილი ტექსტი, არანაირი დამატებითი კომენტარი."
        )
    else:
        system = (
            "გადაწერე ეს ტექსტი პროფესიული სამედიცინო რეგისტრით ქართულ ენაზე. "
            "გამოიყენე ზუსტი სამედიცინო ტერმინოლოგია. "
            "დაამატე კლინიკური დეტალები სადაც შესაძლებელია. "
            "პასუხი: მხოლოდ გადაწერილი ტექსტი, არანაირი დამატებითი კომენტარი."
        )

    try:
        result = await call_haiku(system, text, max_tokens=2000)
        return result.strip() if result else text
    except Exception as e:
        logger.warning("Reading level adjustment failed: %s", str(e)[:100])
        return text


# ═══════════════ HELPERS ═══════════════

def _classify_age(age: int) -> str:
    """Classify age into a group."""
    if age < 0:
        return "adult"
    if age <= 17:
        return "pediatric"
    if age <= 64:
        return "adult"
    return "elderly"


def _has_age_keywords(text: str, age_group: str) -> bool:
    """Check if text contains keywords for a specific age group."""
    keywords = _AGE_KEYWORDS.get(age_group, [])
    return any(kw in text for kw in keywords)


def _get_searchable_text(result: dict[str, Any]) -> str:
    """Extract all text content from a result for keyword matching."""
    parts = [
        result.get("title", ""),
        result.get("body", ""),
        result.get("abstract_summary", ""),
        result.get("abstract", ""),
        " ".join(result.get("tags", [])),
    ]
    return " ".join(p for p in parts if p).lower()
