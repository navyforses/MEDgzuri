"""Tests for Pipeline A — Research Search.

Tests agent logic, aggregation scoring, and fallback behaviors.
LLM calls are mocked since we don't have API keys in CI.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.orchestrator.schemas import NormalizedTerms, ResearchInput
from app.pipelines.research.aggregator import ResearchAggregator
from app.pipelines.research.clinical_trials import ClinicalTrialsAgent
from app.pipelines.research.literature_search import LiteratureSearchAgent
from app.pipelines.research.report_generator import ResearchReportGenerator
from app.pipelines.research.term_normalizer import TermNormalizer


# ═══════════════ A1: Term Normalizer ═══════════════


class TestTermNormalizer:
    @pytest.mark.asyncio
    async def test_fallback_when_llm_unavailable(self):
        """When LLM fails, normalizer returns raw query as-is."""
        with patch("app.pipelines.research.term_normalizer.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            norm = TermNormalizer()
            inp = ResearchInput(diagnosis="ფილტვის კიბო")
            result = await norm.normalize(inp)
            assert result.original_query == "ფილტვის კიბო"
            assert result.english_primary == "ფილტვის კიბო"
            assert "clinicaltrials" in result.search_queries

    @pytest.mark.asyncio
    async def test_llm_success(self):
        """When LLM responds, normalizer uses structured data."""
        mock_response = {
            "english_primary": "lung cancer",
            "english_terms": ["lung cancer", "NSCLC"],
            "mesh_terms": ["Carcinoma, Non-Small-Cell Lung"],
            "icd10": "C34",
            "synonyms": ["pulmonary carcinoma"],
            "search_queries": {
                "clinicaltrials": "lung cancer immunotherapy",
                "pubmed": "NSCLC immunotherapy treatment",
            },
        }
        with patch("app.pipelines.research.term_normalizer.call_sonnet_json",
                    new_callable=AsyncMock, return_value=mock_response):
            norm = TermNormalizer()
            inp = ResearchInput(diagnosis="ფილტვის კიბოს იმუნოთერაპია")
            result = await norm.normalize(inp)
            assert result.english_primary == "lung cancer"
            assert "NSCLC" in result.english_terms
            assert result.icd10 == "C34"
            assert result.search_queries["pubmed"] == "NSCLC immunotherapy treatment"


# ═══════════════ A2: Clinical Trials Agent ═══════════════


class TestClinicalTrialsAgent:
    @pytest.mark.asyncio
    async def test_deduplication(self):
        """Test that duplicate NCT IDs are removed."""
        agent = ClinicalTrialsAgent()
        trials = [
            {"nct_id": "NCT001", "title": "Trial A"},
            {"nct_id": "NCT001", "title": "Trial A duplicate"},
            {"nct_id": "NCT002", "title": "Trial B"},
        ]
        deduped = agent._deduplicate(trials)
        assert len(deduped) == 2
        assert deduped[0]["nct_id"] == "NCT001"
        assert deduped[1]["nct_id"] == "NCT002"

    @pytest.mark.asyncio
    async def test_dedup_mixed_registries(self):
        """Test dedup with different registry ID formats."""
        agent = ClinicalTrialsAgent()
        trials = [
            {"nct_id": "NCT001", "title": "From CT.gov"},
            {"trial_id": "EU-001", "title": "From EU CTR"},
            {"trial_id": "EU-001", "title": "EU CTR dupe"},
            {"nct_id": "", "trial_id": "", "title": "No ID — skipped"},
        ]
        deduped = agent._deduplicate(trials)
        assert len(deduped) == 2

    @pytest.mark.asyncio
    async def test_search_graceful_failures(self):
        """Test that search handles all registries failing."""
        agent = ClinicalTrialsAgent()
        # Mock all three clients to return empty
        agent.ct_gov.search = AsyncMock(return_value=[])
        agent.eu_ctr.search = AsyncMock(return_value=[])
        agent.who.search = AsyncMock(return_value=[])

        terms = NormalizedTerms(english_primary="test", search_queries={"clinicaltrials": "test"})
        result = await agent.search(terms=terms)
        assert result == []


# ═══════════════ A4: Aggregator ═══════════════


class TestResearchAggregator:
    def test_rule_score_recruiting_phase3(self):
        """Test rule-based scoring for recruiting Phase III trial."""
        agg = ResearchAggregator()
        items = [
            {
                "id": "NCT001",
                "type": "trial",
                "data": {
                    "status": "RECRUITING",
                    "phase": "PHASE3",
                    "locations": [{"country": "Turkey"}],
                },
            },
        ]
        scored = agg._rule_score(items)
        assert len(scored) == 1
        # Base 50 + recruiting 20 + phase3 15 + Turkey 20 = 105 → capped at 100
        assert scored[0]["score"] == 100

    def test_rule_score_article(self):
        """Test rule-based scoring for a recent article."""
        agg = ResearchAggregator()
        items = [
            {
                "id": "PMID001",
                "type": "article",
                "data": {"year": 2024},
            },
        ]
        scored = agg._rule_score(items)
        assert scored[0]["score"] == 60  # 50 + 10 (year 2024)

    def test_rule_score_old_article(self):
        agg = ResearchAggregator()
        items = [{"id": "PMID002", "type": "article", "data": {"year": 2020}}]
        scored = agg._rule_score(items)
        assert scored[0]["score"] == 50  # base only

    def test_rule_score_sorting(self):
        """Test that results are sorted by score descending."""
        agg = ResearchAggregator()
        items = [
            {"id": "1", "type": "article", "data": {"year": 2020}},
            {"id": "2", "type": "trial", "data": {"status": "RECRUITING", "phase": "PHASE3", "locations": []}},
            {"id": "3", "type": "article", "data": {"year": 2024}},
        ]
        scored = agg._rule_score(items)
        scores = [s["score"] for s in scored]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.asyncio
    async def test_aggregate_empty(self):
        """Test aggregation with no data."""
        agg = ResearchAggregator()
        result = await agg.aggregate(trials=[], literature={}, original_query="test")
        assert result == []

    @pytest.mark.asyncio
    async def test_aggregate_falls_back_to_rules(self):
        """When LLM fails, aggregator uses rule-based scoring."""
        with patch("app.pipelines.research.aggregator.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            agg = ResearchAggregator()
            result = await agg.aggregate(
                trials=[{"nct_id": "NCT001", "status": "RECRUITING", "phase": "PHASE2", "locations": []}],
                literature={"articles": [{"pmid": "PM001", "year": 2024}]},
                original_query="test",
            )
            assert len(result) == 2
            # All should have scores
            assert all("score" in r for r in result)


# ═══════════════ A5: Report Generator ═══════════════


class TestReportGenerator:
    @pytest.mark.asyncio
    async def test_build_fallback_trials(self):
        """Test fallback report builder with trial data."""
        gen = ResearchReportGenerator()
        scored = [
            {
                "id": "NCT001", "type": "trial", "score": 90,
                "data": {
                    "title": "A Phase III Trial",
                    "phase": "PHASE3",
                    "status": "RECRUITING",
                    "sponsor": "Pharma Corp",
                    "url": "https://clinicaltrials.gov/study/NCT001",
                    "locations": [{"country": "Germany", "facility": "Charité"}],
                },
            },
        ]
        report = gen._build_fallback(scored, "lung cancer")
        assert len(report.items) == 1
        assert "Phase III" in report.items[0].title or "PHASE3" in report.items[0].source
        assert report.disclaimer

    @pytest.mark.asyncio
    async def test_build_fallback_articles(self):
        """Test fallback report builder with article data."""
        gen = ResearchReportGenerator()
        scored = [
            {
                "id": "PM001", "type": "article", "score": 75,
                "data": {
                    "title": "Immunotherapy Review",
                    "journal": "JCO",
                    "year": 2024,
                    "abstract_summary": "A review of immunotherapy approaches.",
                    "source_url": "https://pubmed.ncbi.nlm.nih.gov/12345/",
                },
            },
        ]
        report = gen._build_fallback(scored, "NSCLC")
        assert len(report.items) == 1
        assert "Immunotherapy" in report.items[0].title

    @pytest.mark.asyncio
    async def test_generate_falls_back(self):
        """When both Opus and Sonnet fail, falls back to raw data."""
        with patch("app.pipelines.research.report_generator.call_opus_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")), \
             patch("app.pipelines.research.report_generator.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            gen = ResearchReportGenerator()
            report = await gen.generate(
                scored_results=[{
                    "id": "NCT001", "type": "trial", "score": 80,
                    "data": {"title": "Test Trial", "status": "RECRUITING",
                             "phase": "PHASE2", "sponsor": "Test", "locations": [], "url": ""},
                }],
                literature={"articles": []},
                original_query="test",
            )
            assert len(report.items) == 1
            assert report.disclaimer
