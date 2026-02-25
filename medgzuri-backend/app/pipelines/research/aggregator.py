"""A4 — Aggregator & Relevance Scorer.

Merges trial and literature results, removes duplicates,
and scores each result for relevance (0-100).
"""

import json
import logging

from app.services.llm_client import call_sonnet_json, load_prompt

logger = logging.getLogger(__name__)

# Georgian Patient Accessibility Index
ACCESSIBILITY_BONUS = {
    "türkiye": 20, "turkey": 20,
    "israel": 15,
    "germany": 10,
    "united states": 5, "usa": 5,
    # Other EU
    "france": 8, "spain": 8, "italy": 8, "netherlands": 8,
    "austria": 8, "belgium": 8, "czech republic": 8, "poland": 8,
    "hungary": 8, "greece": 8, "portugal": 8, "sweden": 8,
}


class ResearchAggregator:
    """A4 agent — merge, deduplicate, and score results."""

    async def aggregate(
        self,
        trials: list[dict],
        literature: dict,
        original_query: str,
    ) -> list[dict]:
        """Merge trials and articles, score each, return sorted list."""
        # Build combined items for scoring
        combined = []

        for trial in trials:
            combined.append({
                "id": trial.get("nct_id", ""),
                "type": "trial",
                "data": trial,
            })

        for article in literature.get("articles", []):
            combined.append({
                "id": article.get("pmid", ""),
                "type": "article",
                "data": article,
            })

        if not combined:
            logger.warning("A4 nothing to aggregate")
            return []

        # Try LLM-based scoring
        scored = await self._llm_score(combined, original_query)
        if scored:
            return scored

        # Fallback — rule-based scoring
        return self._rule_score(combined)

    async def _llm_score(self, items: list[dict], query: str) -> list[dict] | None:
        """Use Claude Sonnet to score results."""
        system_prompt = load_prompt("aggregator_scorer")

        # Truncate data to fit in context
        items_brief = []
        for item in items[:30]:
            brief = {"id": item["id"], "type": item["type"]}
            data = item["data"]
            if item["type"] == "trial":
                brief["title"] = data.get("title", "")[:200]
                brief["phase"] = data.get("phase", "")
                brief["status"] = data.get("status", "")
                brief["countries"] = [
                    loc.get("country", "") for loc in data.get("locations", [])[:5]
                ]
                brief["sponsor"] = data.get("sponsor", "")
            else:
                brief["title"] = data.get("title", "")[:200]
                brief["journal"] = data.get("journal", "")
                brief["year"] = data.get("year")
            items_brief.append(brief)

        user_message = (
            f"Query: {query}\n\n"
            f"Items to score ({len(items_brief)}):\n"
            f"{json.dumps(items_brief, indent=2, ensure_ascii=False)}"
        )

        try:
            result = await call_sonnet_json(system_prompt, user_message, max_tokens=3000)
            if result and "scored_results" in result:
                # Merge scores back with full data
                score_map = {r["id"]: r for r in result["scored_results"]}
                scored = []
                for item in items:
                    score_info = score_map.get(item["id"], {})
                    scored.append({
                        **item,
                        "score": score_info.get("score", 50),
                        "score_breakdown": score_info.get("score_breakdown", {}),
                        "accessibility_index": score_info.get("accessibility_index", 0),
                    })
                scored.sort(key=lambda x: x["score"], reverse=True)
                logger.info("A4 LLM scored | items=%d", len(scored))
                return scored
        except Exception as e:
            logger.warning("A4 LLM scoring failed | %s", str(e)[:200])

        return None

    def _rule_score(self, items: list[dict]) -> list[dict]:
        """Fallback rule-based scoring."""
        scored = []
        for item in items:
            score = 50  # base
            data = item["data"]

            if item["type"] == "trial":
                # Recruiting bonus
                status = data.get("status", "").upper()
                if "RECRUITING" in status and "NOT" not in status:
                    score += 20
                elif "NOT_YET" in status:
                    score += 10

                # Phase bonus
                phase = data.get("phase", "").upper()
                if "III" in phase or "3" in phase:
                    score += 15
                elif "II" in phase or "2" in phase:
                    score += 10

                # Accessibility bonus
                for loc in data.get("locations", []):
                    country = loc.get("country", "").lower()
                    bonus = ACCESSIBILITY_BONUS.get(country, 0)
                    if bonus:
                        score += bonus
                        break
            else:
                # Article — newer is better
                year = data.get("year")
                if year and year >= 2024:
                    score += 10
                elif year and year >= 2023:
                    score += 5

            scored.append({**item, "score": min(score, 100), "accessibility_index": 0})

        scored.sort(key=lambda x: x["score"], reverse=True)
        logger.info("A4 rule-scored | items=%d", len(scored))
        return scored
