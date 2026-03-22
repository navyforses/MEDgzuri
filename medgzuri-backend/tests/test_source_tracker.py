"""Tests for source tracker service."""

import pytest

from app.services.source_tracker import SourceTracker


@pytest.fixture
def tracker():
    return SourceTracker()


class TestSourceTracker:
    def test_track_and_get_all(self, tracker):
        tracker.track("Fact 1", "https://pubmed.ncbi.nlm.nih.gov/123", "pubmed", "A3")
        tracker.track("Fact 2", "https://clinicaltrials.gov/ct2/show/NCT001", "clinicaltrials", "A2")
        sources = tracker.get_all()
        assert len(sources) == 2
        assert sources[0].fact == "Fact 1"
        assert sources[1].source_type == "clinicaltrials"

    def test_get_unique_urls(self, tracker):
        tracker.track("Fact 1", "https://example.com/1", "web", "A3")
        tracker.track("Fact 2", "https://example.com/1", "web", "A3")  # duplicate
        tracker.track("Fact 3", "https://example.com/2", "web", "A3")
        urls = tracker.get_unique_urls()
        assert len(urls) == 2
        assert "https://example.com/1" in urls
        assert "https://example.com/2" in urls

    def test_deduplicate(self, tracker):
        tracker.track("Same fact", "https://example.com", "web", "A3")
        tracker.track("Same fact", "https://example.com", "web", "A3")
        tracker.track("Different fact", "https://example.com", "web", "A3")
        tracker.deduplicate()
        sources = tracker.get_all()
        assert len(sources) == 2

    def test_empty_tracker(self, tracker):
        assert tracker.get_all() == []
        assert tracker.get_unique_urls() == []
        assert tracker.summary()["total"] == 0

    def test_summary(self, tracker):
        tracker.track("F1", "https://a.com", "pubmed", "A3")
        tracker.track("F2", "https://b.com", "clinicaltrials", "A2")
        tracker.track("F3", "https://c.com", "pubmed", "A3")
        s = tracker.summary()
        assert s["total"] == 3
        assert s["unique_urls"] == 3
        assert s["by_type"]["pubmed"] == 2
        assert s["by_type"]["clinicaltrials"] == 1

    def test_is_valid_url(self):
        assert SourceTracker.is_valid_url("https://example.com/path") is True
        assert SourceTracker.is_valid_url("http://example.com") is True
        assert SourceTracker.is_valid_url("ftp://example.com") is False
        assert SourceTracker.is_valid_url("not a url") is False
        assert SourceTracker.is_valid_url("") is False

    def test_skip_empty_urls_in_unique(self, tracker):
        tracker.track("Fact 1", "", "web", "A3")
        tracker.track("Fact 2", "https://example.com", "web", "A3")
        urls = tracker.get_unique_urls()
        assert len(urls) == 1
        assert urls[0] == "https://example.com"
