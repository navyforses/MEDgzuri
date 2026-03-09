"""Agent 4: Patient Advisor — generates patient-friendly recommendations.

Creates:
  - Action steps
  - Urgency assessment
  - Comparison tables
  - Language complexity adjustment (patient vs professional)
"""

import logging
from typing import Any

from pydantic import BaseModel, Field

from app.services.llm_client import call_sonnet_json

logger = logging.getLogger(__name__)


class PatientProfile(BaseModel):
    """Patient context for personalized advice."""
    age: int | None = None
    sex: str = ""
    existing_conditions: list[str] = Field(default_factory=list)
    reading_level: str = "patient"  # "patient" | "professional"


class Recommendations(BaseModel):
    """Structured recommendations from the Advisor agent."""
    urgency: str = "normal"  # "emergency" | "urgent" | "normal" | "informational"
    urgency_explanation: str = ""
    action_steps: list[str] = Field(default_factory=list)
    specialist_recommendations: list[str] = Field(default_factory=list)
    comparison_table: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    summary: str = ""


class AdvisorAgent:
    """Generates patient-friendly recommendations from analyzed results."""

    async def advise(
        self,
        analyzed_items: list[dict[str, Any]],
        key_findings: list[str],
        consensus_points: list[str],
        profile: PatientProfile | None = None,
    ) -> Recommendations:
        """Generate recommendations based on analysis results.

        Args:
            analyzed_items: Graded/sorted result items.
            key_findings: Key findings from Analyst.
            consensus_points: Consensus points from Analyst.
            profile: Optional patient profile for personalization.

        Returns:
            Recommendations with action steps, urgency, and comparisons.
        """
        if not analyzed_items:
            return Recommendations(
                summary="შედეგები არ მოიძებნა.",
                action_steps=["მიმართეთ ოჯახის ექიმს დამატებითი კონსულტაციისთვის."],
            )

        logger.info("Advisor | items=%d | profile=%s", len(analyzed_items), bool(profile))

        # Determine audience level
        audience = "professional" if profile and profile.reading_level == "professional" else "patient"

        # Build context for LLM
        context = self._build_context(analyzed_items, key_findings, consensus_points, profile)

        system = self._build_system_prompt(audience)

        try:
            parsed = await call_sonnet_json(system, context, max_tokens=3000)
            if parsed:
                return Recommendations(
                    urgency=parsed.get("urgency", "normal"),
                    urgency_explanation=parsed.get("urgency_explanation", ""),
                    action_steps=parsed.get("action_steps", []),
                    specialist_recommendations=parsed.get("specialist_recommendations", []),
                    comparison_table=parsed.get("comparison_table", {}),
                    warnings=parsed.get("warnings", []),
                    summary=parsed.get("summary", ""),
                )
        except Exception as e:
            logger.warning("Advisor LLM failed: %s", str(e)[:100])

        # Fallback: build basic recommendations without LLM
        return self._fallback_recommendations(analyzed_items, key_findings)

    def _build_context(
        self,
        items: list[dict[str, Any]],
        findings: list[str],
        consensus: list[str],
        profile: PatientProfile | None,
    ) -> str:
        """Build context string for the LLM prompt."""
        parts = []

        # Patient profile
        if profile:
            profile_str = []
            if profile.age:
                profile_str.append(f"ასაკი: {profile.age}")
            if profile.sex:
                profile_str.append(f"სქესი: {profile.sex}")
            if profile.existing_conditions:
                profile_str.append(f"თანმხლები: {', '.join(profile.existing_conditions)}")
            if profile_str:
                parts.append("პაციენტის პროფილი: " + " | ".join(profile_str))

        # Key findings
        if findings:
            parts.append("ძირითადი მიგნებები:\n" + "\n".join(f"- {f}" for f in findings[:5]))

        # Consensus
        if consensus:
            parts.append("კონსენსუსი:\n" + "\n".join(f"- {c}" for c in consensus[:3]))

        # Top items summary
        item_summaries = []
        for item in items[:10]:
            title = item.get("title_ka", item.get("title", ""))
            level = item.get("evidence_level", "")
            source = item.get("_source", item.get("source", ""))
            item_summaries.append(f"[{source}|Level {level}] {title}")
        parts.append("შედეგები:\n" + "\n".join(item_summaries))

        return "\n\n".join(parts)

    def _build_system_prompt(self, audience: str) -> str:
        """Build the system prompt based on audience level."""
        complexity = (
            "გამოიყენე სამედიცინო ტერმინოლოგია და პროფესიული ენა."
            if audience == "professional"
            else "გამოიყენე მარტივი, გასაგები ენა. აუხსენი სამედიცინო ტერმინები."
        )

        return (
            "შენ ხარ მედგზურის სამედიცინო მრჩეველი. "
            "შენ არასოდეს აწერ დიაგნოზს და არასოდეს ნიშნავ წამალს. "
            "შენ მხოლოდ გვირჩევ კონსულტაციას ექიმთან და შესაბამის გამოკვლევებს.\n\n"
            f"{complexity}\n\n"
            "მოგეცემა სამედიცინო კვლევების ანალიზის შედეგები. "
            "შექმენი რეკომენდაციები ქართულ ენაზე.\n\n"
            "პასუხი მხოლოდ JSON:\n"
            "{\n"
            '  "urgency": "normal|urgent|emergency|informational",\n'
            '  "urgency_explanation": "აღწერა ქართულად",\n'
            '  "action_steps": ["ნაბიჯი 1", "ნაბიჯი 2", ...],\n'
            '  "specialist_recommendations": ["სპეციალისტი 1", ...],\n'
            '  "comparison_table": {"headers": [...], "rows": [[...], ...]},\n'
            '  "warnings": ["გაფრთხილება 1", ...],\n'
            '  "summary": "მოკლე შეჯამება ქართულად"\n'
            "}\n\n"
            "მნიშვნელოვანი: ყოველთვის რეკომენდაცია გაუწიე ექიმთან კონსულტაციას!"
        )

    def _fallback_recommendations(
        self, items: list[dict[str, Any]], findings: list[str],
    ) -> Recommendations:
        """Build basic recommendations without LLM."""
        action_steps = [
            "მიმართეთ ოჯახის ექიმს კონსულტაციისთვის.",
            "წაიღეთ ამ კვლევის შედეგები ექიმთან ვიზიტზე.",
        ]

        if findings:
            action_steps.append(
                f"განიხილეთ ექიმთან შემდეგი მიგნებები: {findings[0][:100]}"
            )

        return Recommendations(
            urgency="normal",
            action_steps=action_steps,
            summary="კვლევის შედეგების საფუძველზე რეკომენდირებულია ექიმთან კონსულტაცია.",
            warnings=["⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."],
        )
