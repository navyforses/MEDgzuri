"""WHO International Clinical Trials Registry Platform — best effort.

WHO ICTRP has very limited programmatic access.
This is a best-effort integration that gracefully returns empty results.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SEARCH_URL = "https://trialsearch.who.int/Trial2.aspx"


class WHOICTRPClient:
    """Async client for WHO ICTRP — best effort, limited API."""

    def __init__(self, timeout: int = 20):
        self.timeout = timeout

    async def search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Attempt WHO ICTRP search. Returns empty list if unavailable."""
        # WHO ICTRP does not have a stable REST API
        # This is a placeholder for future implementation
        logger.info("WHO ICTRP | skipped (no stable API) | query=%s", query[:80])
        return []
