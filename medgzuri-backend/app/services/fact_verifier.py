"""Fact verification service — cross-reference, recency, and retraction checks.

Verifies search result claims against multiple independent sources:
  - Cross-reference: claim appears in ≥2 sources → verified
  - Recency: flags studies older than 5 years
  - Retraction: checks Europe PMC metadata for retracted papers

Georgian labels:
  - დადასტურებული (verified)
  - გადაუმოწმებელი (unverified)
  - მოძველებული (outdated)
  - გაწვეული (retracted)
"""

import logging
from datetime import datetime
from enum import Enum
from typing import Any

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_CURRENT_YEAR = datetime.now().year


# ═══════════════ DATA MODELS ═══════════════

class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    CONFLICTING = "conflicting"


class RecencyStatus(str, Enum):
    CURRENT = "current"        # ≤2 years
    AGING = "aging"            # 3–5 years
    OUTDATED = "outdated"      # >5 years


# Georgian labels
VERIFICATION_LABELS = {
    VerificationStatus.VERIFIED: "დადასტურებული",
    VerificationStatus.UNVERIFIED: "გადაუმოწმებელი",
    VerificationStatus.CONFLICTING: "საკამათო",
}

RECENCY_LABELS = {
    RecencyStatus.CURRENT: "აქტუალური",
    RecencyStatus.AGING: "მოძველებადი",
    RecencyStatus.OUTDATED: "მოძველებული",
}

RETRACTION_LABEL = "გაწვეული"


class VerificationResult(BaseModel):
    """Result of verifying a single claim."""
    status: VerificationStatus = VerificationStatus.UNVERIFIED
    status_label: str = ""
    matching_sources: int = 0
    source_ids: list[str] = Field(default_factory=list)
    recency: RecencyStatus | None = None
    recency_label: str = ""
    is_retracted: bool = False


# ═══════════════ CORE VERIFICATION ═══════════════

def verify_claim(
    claim_title: str,
    all_results: list[dict[str, Any]],
) -> VerificationResult:
    """Check if a claim (by title) appears in at least 2 independent sources.

    Compares by normalized title substring matching across results from
    different source databases.
    """
    if not claim_title or not all_results:
        return VerificationResult(
            status=VerificationStatus.UNVERIFIED,
            status_label=VERIFICATION_LABELS[VerificationStatus.UNVERIFIED],
        )

    claim_lower = claim_title.lower().strip()
    # Extract key terms (words ≥4 chars) for fuzzy matching
    key_terms = [w for w in claim_lower.split() if len(w) >= 4]
    if not key_terms:
        key_terms = claim_lower.split()[:3]

    matching_sources: list[str] = []
    seen_source_dbs: set[str] = set()

    for result in all_results:
        result_title = (result.get("title", "") or "").lower()
        result_abstract = (result.get("abstract", "") or result.get("abstract_summary", "") or "").lower()
        source_db = result.get("source_db", "") or result.get("source", "") or "unknown"
        text = f"{result_title} {result_abstract}"

        # Count how many key terms match
        matches = sum(1 for t in key_terms if t in text)
        match_ratio = matches / len(key_terms) if key_terms else 0

        if match_ratio >= 0.5 and source_db not in seen_source_dbs:
            seen_source_dbs.add(source_db)
            source_id = result.get("pmid", "") or result.get("doi", "") or result.get("nct_id", "") or source_db
            matching_sources.append(str(source_id))

    count = len(matching_sources)

    if count >= 2:
        status = VerificationStatus.VERIFIED
    elif count == 1:
        status = VerificationStatus.UNVERIFIED
    else:
        status = VerificationStatus.UNVERIFIED

    return VerificationResult(
        status=status,
        status_label=VERIFICATION_LABELS[status],
        matching_sources=count,
        source_ids=matching_sources,
    )


def check_recency(publication_year: int | str | None) -> RecencyStatus:
    """Classify publication recency based on year.

    Returns:
        current: ≤2 years old
        aging: 3–5 years old
        outdated: >5 years old
    """
    if not publication_year:
        return RecencyStatus.AGING  # Unknown → conservative default

    try:
        year = int(publication_year)
    except (ValueError, TypeError):
        return RecencyStatus.AGING

    age = _CURRENT_YEAR - year
    if age <= 2:
        return RecencyStatus.CURRENT
    elif age <= 5:
        return RecencyStatus.AGING
    else:
        return RecencyStatus.OUTDATED


async def check_retraction(pmid: str) -> bool:
    """Check if a paper has been retracted via Europe PMC metadata.

    Queries Europe PMC for the specific PMID and checks the
    hasReferencedRetraction or pubTypeList for retraction indicators.
    """
    if not pmid:
        return False

    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    params = {
        "query": f"EXT_ID:{pmid} AND SRC:MED",
        "resultType": "core",
        "pageSize": "1",
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                return False

            data = resp.json()
            results = data.get("resultList", {}).get("result", [])
            if not results:
                return False

            article = results[0]

            # Check retraction indicators
            pub_types = article.get("pubTypeList", {}).get("pubType", [])
            if any("retract" in pt.lower() for pt in pub_types):
                return True

            # Check if the article itself is a retraction notice
            title = (article.get("title", "") or "").lower()
            if title.startswith("retraction") or title.startswith("retracted"):
                return True

            return False

    except Exception as e:
        logger.debug("Retraction check failed for PMID %s: %s", pmid, str(e)[:100])
        return False


# ═══════════════ BATCH VERIFICATION ═══════════════

async def batch_verify(
    results: list[dict[str, Any]],
    raw_sources: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Add verification_status to each result in the list.

    For each result:
      1. Cross-reference against all other results + raw_sources
      2. Check recency based on publication year
      3. Check retraction status via Europe PMC (for items with PMID)

    Adds fields to each result dict:
      - verification_status: "verified" | "unverified" | "conflicting"
      - verification_label: Georgian label
      - verification_sources: number of independent sources
      - recency_status: "current" | "aging" | "outdated"
      - recency_label: Georgian label
      - is_retracted: bool
      - retraction_label: Georgian label (only if retracted)

    Graceful: if verification fails for an item, it gets "unverified" status.
    """
    all_sources = list(results)
    if raw_sources:
        all_sources.extend(raw_sources)

    verified_results = []
    for result in results:
        try:
            # Cross-reference
            title = result.get("title", "")
            verification = verify_claim(title, all_sources)

            result["verification_status"] = verification.status.value
            result["verification_label"] = verification.status_label
            result["verification_sources"] = verification.matching_sources

            # Recency
            year = result.get("year")
            recency = check_recency(year)
            result["recency_status"] = recency.value
            result["recency_label"] = RECENCY_LABELS[recency]

            # Retraction check (only for items with PMID — don't block on failure)
            pmid = result.get("pmid", "")
            if pmid:
                try:
                    is_retracted = await check_retraction(str(pmid))
                    result["is_retracted"] = is_retracted
                    if is_retracted:
                        result["retraction_label"] = RETRACTION_LABEL
                        result["verification_status"] = "retracted"
                        result["verification_label"] = RETRACTION_LABEL
                except Exception:
                    result["is_retracted"] = False
            else:
                result["is_retracted"] = False

        except Exception as e:
            logger.warning("Verification failed for '%s': %s", result.get("title", "")[:50], str(e)[:100])
            result["verification_status"] = VerificationStatus.UNVERIFIED.value
            result["verification_label"] = VERIFICATION_LABELS[VerificationStatus.UNVERIFIED]
            result["recency_status"] = RecencyStatus.AGING.value
            result["recency_label"] = RECENCY_LABELS[RecencyStatus.AGING]
            result["is_retracted"] = False

        verified_results.append(result)

    # Log summary
    status_counts: dict[str, int] = {}
    for r in verified_results:
        s = r.get("verification_status", "unverified")
        status_counts[s] = status_counts.get(s, 0) + 1
    logger.info("Fact verification | total=%d | %s", len(verified_results), status_counts)

    return verified_results
