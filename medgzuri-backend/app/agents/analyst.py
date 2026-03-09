"""Agent 2: Analysis Agent — evidence grading, cross-referencing, insight extraction.

Takes raw results from Researcher and produces:
  - Evidence-graded items
  - Cross-reference verification
  - Contradiction detection
  - Key findings and insights
"""

import logging
from typing import Any

from app.services.evidence_grader import grade_evidence, sort_by_evidence
from app.services.llm_client import call_sonnet_json

logger = logging.getLogger(__name__)


class AnalyzedResults:
    """Container for analyzed and graded results."""

    def __init__(self) -> None:
        self.graded_items: list[dict[str, Any]] = []
        self.key_findings: list[str] = []
        self.contradictions: list[dict[str, str]] = []
        self.consensus_points: list[str] = []
        self.evidence_summary: dict[str, int] = {}
        self.total_sources: int = 0


class AnalystAgent:
    """Analyzes raw research results: grades evidence, finds patterns."""

    async def analyze(self, raw_items: list[dict[str, Any]]) -> AnalyzedResults:
        """Analyze raw results from the Researcher agent.

        Args:
            raw_items: Flat list of results (each has _source tag).

        Returns:
            AnalyzedResults with grading, findings, and contradictions.
        """
        logger.info("Analyst | processing %d items", len(raw_items))
        result = AnalyzedResults()
        result.total_sources = len(set(item.get("_source", "") for item in raw_items))

        if not raw_items:
            return result

        # Step 1: Grade evidence for each item
        graded = []
        for item in raw_items:
            try:
                graded_item = grade_evidence(item)
                graded.append(graded_item)
            except Exception as e:
                logger.debug("Grading failed for item: %s", str(e)[:80])
                graded.append(item)

        # Step 2: Sort by evidence quality
        result.graded_items = sort_by_evidence(graded)

        # Step 3: Build evidence summary
        result.evidence_summary = self._build_evidence_summary(result.graded_items)

        # Step 4: Extract findings and contradictions via LLM (if enough items)
        if len(result.graded_items) >= 3:
            insights = await self._extract_insights(result.graded_items)
            result.key_findings = insights.get("key_findings", [])
            result.contradictions = insights.get("contradictions", [])
            result.consensus_points = insights.get("consensus_points", [])

        logger.info(
            "Analyst done | graded=%d | findings=%d | contradictions=%d",
            len(result.graded_items), len(result.key_findings), len(result.contradictions),
        )
        return result

    def _build_evidence_summary(self, items: list[dict]) -> dict[str, int]:
        """Count items per evidence level."""
        counts: dict[str, int] = {"I": 0, "II": 0, "III": 0, "IV": 0, "V": 0}
        for item in items:
            level = item.get("evidence_level", "V")
            if level in counts:
                counts[level] += 1
            else:
                counts["V"] += 1
        return counts

    async def _extract_insights(self, items: list[dict]) -> dict[str, Any]:
        """Use LLM to extract key findings and contradictions from results."""
        # Build a concise summary of top items for LLM analysis
        summaries = []
        for item in items[:15]:
            title = item.get("title", "")
            abstract = item.get("abstract", item.get("abstract_summary", ""))[:300]
            source = item.get("_source", "")
            level = item.get("evidence_level", "")
            summaries.append(f"[{source}|Level {level}] {title}\n{abstract}")

        combined = "\n---\n".join(summaries)

        system = (
            "You are a medical research analyst. Analyze these research results and extract:\n"
            "1. key_findings: list of 3-5 most important findings (short sentences, English)\n"
            "2. contradictions: list of objects {claim1, claim2, explanation} where studies disagree\n"
            "3. consensus_points: list of 2-3 points where multiple sources agree\n\n"
            "Return JSON only:\n"
            '{"key_findings": [...], "contradictions": [{...}], "consensus_points": [...]}'
        )

        try:
            parsed = await call_sonnet_json(system, combined, max_tokens=4096)
            if parsed:
                return {
                    "key_findings": parsed.get("key_findings", []),
                    "contradictions": parsed.get("contradictions", []),
                    "consensus_points": parsed.get("consensus_points", []),
                }
        except Exception as e:
            logger.warning("Insight extraction failed: %s", str(e)[:100])

        return {"key_findings": [], "contradictions": [], "consensus_points": []}
