"""Tests for Pipeline B — Symptom Navigation.

Tests symptom parsing, differential analysis, and fallback behaviors.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.orchestrator.schemas import ParsedSymptoms, SymptomsInput
from app.pipelines.symptoms import SymptomPipeline
from app.pipelines.symptoms.differential import DifferentialAnalysis
from app.pipelines.symptoms.navigator_report import NavigatorReportGenerator
from app.pipelines.symptoms.symptom_parser import SymptomParser


# ═══════════════ B1: Symptom Parser ═══════════════


class TestSymptomParser:
    @pytest.mark.asyncio
    async def test_fallback_when_llm_unavailable(self):
        """Parser returns minimal structure when LLM fails."""
        with patch("app.pipelines.symptoms.symptom_parser.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            parser = SymptomParser()
            inp = SymptomsInput(
                symptoms_text="თავის ტკივილი და მხედველობის დაბინდვა",
                age=45, sex="male",
            )
            result = await parser.parse(inp)
            assert len(result.extracted_symptoms) == 1
            assert result.patient_context.get("age") == 45

    @pytest.mark.asyncio
    async def test_llm_success(self):
        """Parser correctly structures LLM output."""
        mock_response = {
            "extracted_symptoms": [
                {"ka": "თავის ტკივილი", "en": "headache", "medical": "cephalalgia", "severity": "moderate"},
                {"ka": "მხედველობის დაბინდვა", "en": "blurred vision", "medical": "amblyopia", "severity": "mild"},
            ],
            "patient_context": {"age": 45, "sex": "male"},
            "possible_medication_side_effects": [],
            "red_flags": ["sudden severe headache with vision changes"],
        }
        with patch("app.pipelines.symptoms.symptom_parser.call_sonnet_json",
                    new_callable=AsyncMock, return_value=mock_response):
            parser = SymptomParser()
            inp = SymptomsInput(symptoms_text="test", age=45, sex="male")
            result = await parser.parse(inp)
            assert len(result.extracted_symptoms) == 2
            assert len(result.red_flags) == 1


# ═══════════════ B2: Differential Analysis ═══════════════


class TestDifferentialAnalysis:
    @pytest.mark.asyncio
    async def test_fallback_when_sonnet_fails(self):
        """Returns empty structure when Sonnet fails."""
        with patch("app.pipelines.symptoms.differential.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            diff = DifferentialAnalysis()
            parsed = ParsedSymptoms(
                extracted_symptoms=[{"ka": "ტკივილი", "en": "pain"}],
                patient_context={"age": 45},
            )
            result = await diff.analyze(parsed)
            assert result["research_directions"] == []
            assert "disclaimer" in result

    @pytest.mark.asyncio
    async def test_sonnet_success(self):
        """Test successful Sonnet analysis."""
        mock_response = {
            "research_directions": [
                {
                    "condition": "migraine",
                    "condition_ka": "მიგრენი",
                    "relevance_explanation": "Headache with visual symptoms",
                    "matching_symptoms": ["headache", "blurred vision"],
                    "confidence": "likely",
                },
                {
                    "condition": "tension headache",
                    "condition_ka": "ტენზიური თავის ტკივილი",
                    "relevance_explanation": "Common cause of headache",
                    "matching_symptoms": ["headache"],
                    "confidence": "possible",
                },
            ],
            "recommended_specialists": ["ნევროლოგი", "ოფთალმოლოგი"],
            "recommended_tests": ["MRI", "სისხლის ანალიზი"],
            "medication_interaction_note": "",
            "disclaimer": "ეს არ არის დიაგნოზი",
        }
        with patch("app.pipelines.symptoms.differential.call_sonnet_json",
                    new_callable=AsyncMock, return_value=mock_response):
            diff = DifferentialAnalysis()
            parsed = ParsedSymptoms(
                extracted_symptoms=[
                    {"ka": "თავის ტკივილი", "en": "headache"},
                    {"ka": "მხედველობის დაბინდვა", "en": "blurred vision"},
                ],
            )
            result = await diff.analyze(parsed)
            assert len(result["research_directions"]) == 2
            assert "ნევროლოგი" in result["recommended_specialists"]


# ═══════════════ B4: Navigator Report ═══════════════


class TestNavigatorReport:
    @pytest.mark.asyncio
    async def test_build_fallback(self):
        """Fallback report from raw data."""
        gen = NavigatorReportGenerator()
        parsed = ParsedSymptoms(
            extracted_symptoms=[
                {"ka": "თავის ტკივილი", "en": "headache"},
            ],
        )
        differential = {
            "research_directions": [
                {"condition": "migraine", "condition_ka": "მიგრენი",
                 "relevance_explanation": "Common headache cause", "confidence": "likely"},
            ],
            "recommended_specialists": ["ნევროლოგი"],
        }
        report = gen._build_fallback(parsed, differential, "თავის ტკივილი")
        assert len(report.items) >= 2
        assert report.disclaimer

    @pytest.mark.asyncio
    async def test_generate_falls_back(self):
        """Full generation falls back when LLMs fail."""
        with patch("app.pipelines.symptoms.navigator_report.call_opus_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")), \
             patch("app.pipelines.symptoms.navigator_report.call_sonnet_json",
                    new_callable=AsyncMock, side_effect=Exception("no key")):
            gen = NavigatorReportGenerator()
            parsed = ParsedSymptoms(
                extracted_symptoms=[{"ka": "ტკივილი", "en": "pain"}],
            )
            report = await gen.generate(
                parsed=parsed,
                differential={"research_directions": [], "recommended_specialists": []},
                matched_research={},
                original_symptoms="ტკივილი",
            )
            assert report.disclaimer
            assert len(report.items) >= 1


# ═══════════════ Full Pipeline B ═══════════════


class TestSymptomPipeline:
    @pytest.mark.asyncio
    async def test_b1_failure_returns_error(self):
        """If B1 fails completely, pipeline returns error response."""
        pipeline = SymptomPipeline()
        pipeline.parser.parse = AsyncMock(side_effect=Exception("B1 crash"))
        inp = SymptomsInput(symptoms_text="test")
        result = await pipeline.execute(inp)
        assert "ვერ მოხერხდა" in result.meta
        assert result.disclaimer
