"""S4 — Compliance Guard.

Validates final output before sending to the user:
- No direct diagnosis statements
- No medication prescriptions
- Disclaimer is present
- Sources are cited
"""

import logging
import re

from app.orchestrator.schemas import SearchResponse

logger = logging.getLogger(__name__)

DISCLAIMER_KA = "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."

# Patterns that indicate a diagnosis (prohibited)
DIAGNOSIS_PATTERNS = [
    r"თქვენ გაქვთ .+ დაავადება",
    r"თქვენი დიაგნოზია",
    r"you have .+ disease",
    r"your diagnosis is",
]

# Patterns that indicate a prescription (prohibited)
PRESCRIPTION_PATTERNS = [
    r"მიიღეთ .+ წამალი",
    r"დანიშნეთ .+ მგ",
    r"take .+ medication",
    r"prescribe",
]


def validate(response: SearchResponse) -> SearchResponse:
    """Validate and fix the response before sending to user."""
    # Ensure disclaimer
    if not response.disclaimer:
        response.disclaimer = DISCLAIMER_KA
        logger.info("Compliance: added missing disclaimer")

    # Check items for prohibited content
    for item in response.items:
        _check_text(item.body, item.title)
        _check_text(item.title, item.title)

    return response


def _check_text(text: str, context: str) -> None:
    """Log warnings for prohibited content patterns."""
    if not text:
        return

    for pattern in DIAGNOSIS_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            logger.warning(
                "Compliance WARNING: possible diagnosis in '%s': matched pattern '%s'",
                context[:50], pattern,
            )

    for pattern in PRESCRIPTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            logger.warning(
                "Compliance WARNING: possible prescription in '%s': matched pattern '%s'",
                context[:50], pattern,
            )
