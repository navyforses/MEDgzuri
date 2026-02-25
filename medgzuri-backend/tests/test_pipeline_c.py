"""Tests for Pipeline C — Clinic Search.

Tests clinic finding, rating, cost estimation, and fallback behaviors.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.orchestrator.schemas import ClinicInput, ClinicResult, ClinicWithRating
from app.pipelines.clinics import ClinicPipeline
from app.pipelines.clinics.clinic_finder import ClinicFinder
from app.pipelines.clinics.cost_agent import ClinicCostAgent
from app.pipelines.clinics.rating_agent import ClinicRatingAgent


# ═══════════════ C2: Clinic Finder ═══════════════


class TestClinicFinder:
    def test_extract_facilities(self):
        """Extract unique facilities from trial locations."""
        finder = ClinicFinder()
        trials = [
            {
                "nct_id": "NCT001",
                "url": "https://clinicaltrials.gov/study/NCT001",
                "locations": [
                    {"facility": "Charité", "country": "Germany", "city": "Berlin"},
                    {"facility": "Memorial", "country": "Türkiye", "city": "Istanbul"},
                ],
            },
            {
                "nct_id": "NCT002",
                "url": "https://clinicaltrials.gov/study/NCT002",
                "locations": [
                    {"facility": "Charité", "country": "Germany", "city": "Berlin"},
                    {"facility": "Sheba", "country": "Israel", "city": "Ramat Gan"},
                ],
            },
        ]
        clinics = finder._extract_facilities(trials)
        assert len(clinics) == 3  # Charité (deduped), Memorial, Sheba
        # Charité should have 2 trials (appears in both)
        charite = next(c for c in clinics if c.name == "Charité")
        assert charite.active_trials_count == 2
        assert charite.country == "Germany"

    def test_extract_skips_empty(self):
        """Skip locations without facility or country."""
        finder = ClinicFinder()
        trials = [
            {
                "nct_id": "NCT001",
                "url": "",
                "locations": [
                    {"facility": "", "country": "Germany", "city": "Berlin"},
                    {"facility": "Hospital", "country": "", "city": "Unknown"},
                    {"facility": "Valid Hospital", "country": "Turkey", "city": "Ankara"},
                ],
            },
        ]
        clinics = finder._extract_facilities(trials)
        assert len(clinics) == 1
        assert clinics[0].name == "Valid Hospital"

    def test_facilities_sorted_by_trials(self):
        """Facilities should be sorted by active_trials_count descending."""
        finder = ClinicFinder()
        trials = [
            {"nct_id": f"NCT{i:03d}", "url": "", "locations": [
                {"facility": "Popular Hospital", "country": "Germany", "city": "Berlin"},
            ]}
            for i in range(5)
        ] + [
            {"nct_id": "NCT100", "url": "", "locations": [
                {"facility": "Small Clinic", "country": "Turkey", "city": "Ankara"},
            ]},
        ]
        clinics = finder._extract_facilities(trials)
        assert clinics[0].name == "Popular Hospital"
        assert clinics[0].active_trials_count == 5


# ═══════════════ C3: Rating Agent ═══════════════


class TestRatingAgent:
    def test_basic_rating_jci(self):
        """JCI-accredited facilities get bonus."""
        rater = ClinicRatingAgent()
        clinic = ClinicResult(name="Memorial Hospital", country="Turkey", active_trials_count=3)
        rated = rater._basic_rating(clinic)
        assert rated.jci_accredited is True
        # 50 + 10 (JCI) + 15 (3 trials * 5) = 75
        assert rated.rating_score == 75

    def test_basic_rating_unknown(self):
        """Unknown facilities get base score only."""
        rater = ClinicRatingAgent()
        clinic = ClinicResult(name="Unknown Local Hospital", country="Georgia", active_trials_count=1)
        rated = rater._basic_rating(clinic)
        assert rated.jci_accredited is False
        # 50 + 0 (no JCI) + 5 (1 trial * 5) = 55
        assert rated.rating_score == 55

    def test_calculate_score_max(self):
        """Score should be capped at 100."""
        rater = ClinicRatingAgent()
        clinic = ClinicResult(name="Mayo Clinic", country="USA", active_trials_count=10)
        score = rater._calculate_score(clinic, jci=True, pub_count=10)
        assert score == 100  # 40 + 15 + 50 + 25 would be 130 → capped at 100


# ═══════════════ C4: Cost Agent ═══════════════


class TestCostAgent:
    @pytest.mark.asyncio
    async def test_estimate_turkey(self):
        """Turkey: no visa, cheap flights."""
        agent = ClinicCostAgent()
        clinics = [
            ClinicWithRating(
                name="Memorial Istanbul", country="Turkey",
                city="Istanbul", rating_score=80,
            ),
        ]
        result = await agent.estimate(clinics, "brain tumor")
        assert len(result) == 1
        assert result[0].visa_required is False
        assert "80-200" in result[0].estimated_flight_cost

    @pytest.mark.asyncio
    async def test_estimate_germany(self):
        """Germany: visa required, moderate costs."""
        agent = ClinicCostAgent()
        clinics = [
            ClinicWithRating(
                name="Charité", country="Germany",
                city="Berlin", rating_score=90,
            ),
        ]
        result = await agent.estimate(clinics, "lung cancer")
        assert len(result) == 1
        assert result[0].visa_required is True
        assert "200-400" in result[0].estimated_flight_cost

    @pytest.mark.asyncio
    async def test_estimate_unknown_country(self):
        """Unknown country gets default values."""
        agent = ClinicCostAgent()
        clinics = [
            ClinicWithRating(
                name="Hospital", country="SomeCountry",
                city="City", rating_score=50,
            ),
        ]
        result = await agent.estimate(clinics, "test")
        assert len(result) == 1
        assert result[0].visa_required is True  # default

    @pytest.mark.asyncio
    async def test_estimate_empty(self):
        agent = ClinicCostAgent()
        result = await agent.estimate([], "test")
        assert result == []


# ═══════════════ C5: Clinic Report ═══════════════


class TestClinicReport:
    @pytest.mark.asyncio
    async def test_full_pipeline_c2_empty(self):
        """Pipeline returns error when no clinics found."""
        pipeline = ClinicPipeline()
        pipeline.query_builder.build = AsyncMock(
            return_value={"english_primary": "brain tumor", "search_queries": {}}
        )
        pipeline.finder.find = AsyncMock(return_value=[])
        inp = ClinicInput(diagnosis_or_treatment="brain tumor")
        result = await pipeline.execute(inp)
        assert "ვერ მოიძებნა" in result.meta

    @pytest.mark.asyncio
    async def test_c1_failure_returns_error(self):
        """Pipeline returns error when C1 fails."""
        pipeline = ClinicPipeline()
        pipeline.query_builder.build = AsyncMock(side_effect=Exception("C1 crash"))
        inp = ClinicInput(diagnosis_or_treatment="test")
        result = await pipeline.execute(inp)
        assert result.disclaimer
