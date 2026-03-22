"""EU Clinical Trials Register (CTIS) integration — best effort.

The CTIS public API has limited documentation and may change.
This integration attempts to query it but gracefully degrades.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CTIS_URL = "https://euclinicaltrials.eu/ctis-public-api/search"


class EUCTRClient:
    """Async client for EU Clinical Trials Register."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    async def search(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Search EU CTR. Returns empty list if API unavailable."""
        params = {
            "searchCriteria.query": query,
            "searchCriteria.pageSize": str(max_results),
        }

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(CTIS_URL, params=params)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if resp.status_code != 200:
                    logger.info(
                        "EU CTR | status=%d | %dms (best-effort, non-critical)",
                        resp.status_code, elapsed_ms,
                    )
                    return []

                data = resp.json()
                trials = data.get("data", data.get("results", []))
                if not isinstance(trials, list):
                    trials = []

                logger.info("EU CTR OK | results=%d | %dms", len(trials), elapsed_ms)
                return [self._parse_trial(t) for t in trials[:max_results]]

        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.info("EU CTR unavailable | %dms | %s (non-critical)", elapsed_ms, str(e)[:100])
            return []

    def _parse_trial(self, t: dict) -> dict[str, Any]:
        return {
            "trial_id": t.get("ctNumber", t.get("id", "")),
            "title": t.get("ctTitle", t.get("title", "")),
            "status": t.get("ctStatus", t.get("status", "")),
            "phase": t.get("trialPhase", ""),
            "source_registry": "EU CTR",
            "url": "",
        }
