"""S3 — Source Tracker.

Tracks source URLs for every fact in search results.
Each pipeline creates a SourceTracker instance and passes it to agents.
Agents call tracker.track() for each fact they produce.
Report generators use tracker.get_all() to list citations.
"""

import logging
from urllib.parse import urlparse

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SourceEntry(BaseModel):
    """A single tracked source."""
    fact: str = ""
    source_url: str = ""
    source_type: str = ""  # pubmed, clinicaltrials, europe_pmc, web, llm
    agent_id: str = ""     # e.g. A2, A3, C2


class SourceTracker:
    """Per-request source tracking. Not thread-safe — one instance per pipeline run."""

    def __init__(self):
        self._sources: list[SourceEntry] = []

    def track(self, fact: str, source_url: str, source_type: str = "", agent_id: str = ""):
        """Register a fact with its source URL."""
        self._sources.append(SourceEntry(
            fact=fact,
            source_url=source_url,
            source_type=source_type,
            agent_id=agent_id,
        ))

    def get_all(self) -> list[SourceEntry]:
        """Return all tracked sources."""
        return list(self._sources)

    def get_unique_urls(self) -> list[str]:
        """Return deduplicated list of source URLs."""
        seen = set()
        urls = []
        for entry in self._sources:
            if entry.source_url and entry.source_url not in seen:
                seen.add(entry.source_url)
                urls.append(entry.source_url)
        return urls

    def deduplicate(self):
        """Remove duplicate entries (same URL + same fact)."""
        seen = set()
        unique = []
        for entry in self._sources:
            key = (entry.fact[:100], entry.source_url)
            if key not in seen:
                seen.add(key)
                unique.append(entry)
        self._sources = unique

    def attach_to_items(self, items: list) -> list:
        """Attach source URLs to result items that match tracked facts.

        For items that have no URL, tries to find a matching source.
        """
        url_by_title = {}
        for entry in self._sources:
            if entry.source_url and entry.fact:
                url_by_title[entry.fact[:80].lower()] = entry.source_url

        for item in items:
            if not getattr(item, "url", None):
                # Try to match by title
                key = getattr(item, "title", "")[:80].lower()
                if key in url_by_title:
                    item.url = url_by_title[key]

        return items

    def summary(self) -> dict:
        """Return a summary of tracked sources for logging."""
        by_type: dict[str, int] = {}
        for entry in self._sources:
            t = entry.source_type or "unknown"
            by_type[t] = by_type.get(t, 0) + 1
        return {
            "total": len(self._sources),
            "unique_urls": len(self.get_unique_urls()),
            "by_type": by_type,
        }

    @staticmethod
    def is_valid_url(url: str) -> bool:
        """Basic URL validation."""
        try:
            result = urlparse(url)
            return all([result.scheme in ("http", "https"), result.netloc])
        except Exception:
            return False
