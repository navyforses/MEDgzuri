"""Evidence grading system for medical search results.

Assigns evidence levels (I–V) based on study type detection:
  I:   Systematic review / meta-analysis
  II:  Randomized controlled trial (RCT)
  III: Cohort study / case-control
  IV:  Case series / case report
  V:   Expert opinion / narrative review / other

Also assigns recency and citation scores for ranking.
"""

import logging
import re
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Current year for recency scoring
_CURRENT_YEAR = datetime.now().year


# ═══════════════ EVIDENCE LEVEL DETECTION ═══════════════

# Patterns are checked against title + abstract (lowercased)
_LEVEL_I_PATTERNS = [
    r"\bsystematic review\b",
    r"\bmeta[\-\s]?analysis\b",
    r"\bcochrane\b",
    r"\bprisma\b",
    r"\bumbrella review\b",
]

_LEVEL_II_PATTERNS = [
    r"\brandomized\b",
    r"\brandomised\b",
    r"\brct\b",
    r"\bdouble[\-\s]?blind\b",
    r"\bplacebo[\-\s]?controlled\b",
    r"\brandom allocation\b",
    r"\brandom assignment\b",
]

_LEVEL_III_PATTERNS = [
    r"\bcohort\b",
    r"\bcase[\-\s]?control\b",
    r"\bprospective study\b",
    r"\bretrospective study\b",
    r"\bprospective\b.*\bstudy\b",
    r"\bretrospective\b.*\bstudy\b",
    r"\bobservational study\b",
    r"\bcross[\-\s]?sectional\b",
    r"\blongitudinal\b",
]

_LEVEL_IV_PATTERNS = [
    r"\bcase report\b",
    r"\bcase series\b",
    r"\bcase study\b",
]

# Compiled for performance
_COMPILED = {
    "I": [re.compile(p, re.IGNORECASE) for p in _LEVEL_I_PATTERNS],
    "II": [re.compile(p, re.IGNORECASE) for p in _LEVEL_II_PATTERNS],
    "III": [re.compile(p, re.IGNORECASE) for p in _LEVEL_III_PATTERNS],
    "IV": [re.compile(p, re.IGNORECASE) for p in _LEVEL_IV_PATTERNS],
}

# Georgian labels for evidence levels
EVIDENCE_LABELS = {
    "I": "სისტემატური მიმოხილვა / მეტა-ანალიზი",
    "II": "რანდომიზებული კონტროლირებული კვლევა",
    "III": "კოჰორტული / შემთხვევა-კონტროლი კვლევა",
    "IV": "შემთხვევის აღწერა / შემთხვევების სერია",
    "V": "ექსპერტის მოსაზრება / მიმოხილვა",
}

# Visual markers for evidence levels
EVIDENCE_MARKERS = {
    "I": "🟢",
    "II": "🔵",
    "III": "🟡",
    "IV": "🟠",
    "V": "⚪",
}


def grade_evidence(result: dict[str, Any]) -> dict[str, Any]:
    """Grade a single search result and add evidence metadata.

    Adds to the result dict:
      - evidence_level: str ("I" through "V")
      - evidence_label: str (Georgian description)
      - evidence_marker: str (emoji indicator)
      - recency_score: float (0.0–1.0, higher = newer)
      - citation_score: float (0.0–1.0, normalized)

    Returns the same dict (mutated) for convenience.
    """
    title = result.get("title", "") or ""
    abstract = result.get("abstract", "") or result.get("abstract_summary", "") or ""
    journal = result.get("journal", "") or ""
    evidence_type = result.get("evidence_type", "") or ""

    text = f"{title} {abstract} {journal} {evidence_type}".lower()

    # Detect evidence level — check from highest to lowest
    level = "V"
    for lvl in ("I", "II", "III", "IV"):
        if any(p.search(text) for p in _COMPILED[lvl]):
            level = lvl
            break

    # Also check source_db for Cochrane
    source_db = (result.get("source_db", "") or "").lower()
    if "cochrane" in source_db and level not in ("I",):
        level = "I"

    result["evidence_level"] = level
    result["evidence_label"] = EVIDENCE_LABELS[level]
    result["evidence_marker"] = EVIDENCE_MARKERS[level]

    # Recency score: 1.0 for current year, decays linearly over 10 years
    year = result.get("year")
    if year:
        try:
            year_int = int(year)
            age = max(0, _CURRENT_YEAR - year_int)
            result["recency_score"] = round(max(0.0, 1.0 - age / 10.0), 2)
        except (ValueError, TypeError):
            result["recency_score"] = 0.5
    else:
        result["recency_score"] = 0.5

    # Citation score: normalized (capped at 100 citations = 1.0)
    cited_by = result.get("cited_by_count", 0) or 0
    try:
        cited_by = int(cited_by)
        result["citation_score"] = round(min(1.0, cited_by / 100.0), 2)
    except (ValueError, TypeError):
        result["citation_score"] = 0.0

    return result


def sort_by_evidence(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort results by evidence quality (best first).

    Sorting priority:
      1. Evidence level (I > II > III > IV > V)
      2. Recency score (newer first)
      3. Citation score (more cited first)
    """
    level_order = {"I": 0, "II": 1, "III": 2, "IV": 3, "V": 4}

    def sort_key(r: dict) -> tuple:
        lvl = r.get("evidence_level", "V")
        return (
            level_order.get(lvl, 4),
            -(r.get("recency_score", 0.5)),
            -(r.get("citation_score", 0.0)),
        )

    return sorted(results, key=sort_key)


def grade_and_sort(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Grade all results and return sorted by evidence quality."""
    graded = [grade_evidence(r) for r in results]
    sorted_results = sort_by_evidence(graded)

    # Log summary
    level_counts = {}
    for r in sorted_results:
        lvl = r.get("evidence_level", "V")
        level_counts[lvl] = level_counts.get(lvl, 0) + 1
    logger.info("Evidence grading | total=%d | %s", len(sorted_results), level_counts)

    return sorted_results
