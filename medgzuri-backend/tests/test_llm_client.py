"""Tests for the LLM client — JSON extraction and prompt loading."""

import pytest

from app.services.llm_client import extract_json, load_prompt


class TestExtractJson:
    """Tests for JSON extraction from LLM output."""

    def test_code_fence_json(self):
        text = 'Here is the result:\n```json\n{"key": "value", "count": 42}\n```\nDone.'
        result = extract_json(text)
        assert result == {"key": "value", "count": 42}

    def test_code_fence_no_lang(self):
        text = '```\n{"key": "value"}\n```'
        result = extract_json(text)
        assert result == {"key": "value"}

    def test_raw_json(self):
        text = '{"english_primary": "lung cancer", "mesh_terms": ["Carcinoma"]}'
        result = extract_json(text)
        assert result["english_primary"] == "lung cancer"

    def test_json_with_preamble(self):
        text = 'I analyzed the query. Here is the output:\n{"result": "ok"}'
        result = extract_json(text)
        assert result == {"result": "ok"}

    def test_nested_json(self):
        text = '{"outer": {"inner": [1, 2, 3]}, "flag": true}'
        result = extract_json(text)
        assert result["outer"]["inner"] == [1, 2, 3]
        assert result["flag"] is True

    def test_no_json(self):
        text = "This is just plain text with no JSON."
        result = extract_json(text)
        assert result is None

    def test_json_with_unicode(self):
        text = '{"query": "ფილტვის კიბო", "en": "lung cancer"}'
        result = extract_json(text)
        assert result["query"] == "ფილტვის კიბო"

    def test_json_with_escaped_quotes(self):
        text = '{"text": "He said \\"hello\\"", "count": 1}'
        result = extract_json(text)
        assert result["count"] == 1

    def test_multiple_json_objects(self):
        text = 'First: {"a": 1} Second: {"b": 2}'
        result = extract_json(text)
        # Should extract the first valid JSON
        assert result == {"a": 1}

    def test_json_array_ignored(self):
        text = '[1, 2, 3]'
        result = extract_json(text)
        # extract_json only returns dicts
        assert result is None

    def test_malformed_json(self):
        text = '{"key": "value", "broken"}'
        result = extract_json(text)
        assert result is None


class TestLoadPrompt:
    """Tests for prompt template loading."""

    def test_load_term_normalizer(self):
        prompt = load_prompt("term_normalizer")
        assert len(prompt) > 50
        assert "JSON" in prompt or "json" in prompt

    def test_load_research_report(self):
        prompt = load_prompt("research_report")
        assert len(prompt) > 50

    def test_load_symptom_parser(self):
        prompt = load_prompt("symptom_parser")
        assert len(prompt) > 50

    def test_load_differential_analysis(self):
        prompt = load_prompt("differential_analysis")
        assert len(prompt) > 50

    def test_load_navigator_report(self):
        prompt = load_prompt("navigator_report")
        assert len(prompt) > 50

    def test_load_clinic_query_builder(self):
        prompt = load_prompt("clinic_query_builder")
        assert len(prompt) > 50

    def test_load_clinic_report(self):
        prompt = load_prompt("clinic_report")
        assert len(prompt) > 50

    def test_load_aggregator_scorer(self):
        prompt = load_prompt("aggregator_scorer")
        assert len(prompt) > 50

    def test_load_literature_summarizer(self):
        prompt = load_prompt("literature_summarizer")
        assert len(prompt) > 50

    def test_load_nonexistent_raises(self):
        with pytest.raises(FileNotFoundError):
            load_prompt("nonexistent_prompt")
