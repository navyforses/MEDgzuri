"""B2.5 — Drug Safety Enrichment Agent.

Cross-references medications mentioned in symptom analysis with OpenFDA
for interactions, warnings, and adverse events.
Runs between B2 (Differential) and B3 (Research Matcher).
"""

import asyncio
import logging
from typing import Any

from app.integrations.drugbank_open import OpenFDAClient

logger = logging.getLogger(__name__)


class DrugSafetyEnricher:
    """Enrich differential analysis with FDA drug safety data."""

    def __init__(self) -> None:
        self.fda = OpenFDAClient(timeout=20)

    async def enrich(
        self,
        medications: list[str],
        side_effects: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Look up medications in OpenFDA and return safety data.

        Args:
            medications: List of medication names from patient context.
            side_effects: Possible medication side effects identified by B1.

        Returns:
            {
                "drug_info": [...],
                "interaction_warnings": [...],
                "adverse_event_signals": [...],
            }
        """
        if not medications and not side_effects:
            return {"drug_info": [], "interaction_warnings": [], "adverse_event_signals": []}

        # Collect all drug names (from medications + side effects)
        drug_names: list[str] = list(medications)
        for se in side_effects:
            med = se.get("medication", se.get("drug", ""))
            if med and med not in drug_names:
                drug_names.append(med)

        if not drug_names:
            return {"drug_info": [], "interaction_warnings": [], "adverse_event_signals": []}

        # Limit to first 5 drugs to avoid API throttling
        drug_names = drug_names[:5]

        # Parallel lookups: labels + adverse events for each drug
        label_tasks = [self.fda.search_drug(name, limit=1) for name in drug_names]
        adverse_tasks = [self.fda.search_adverse_events(name, limit=3) for name in drug_names]

        all_results = await asyncio.gather(
            *label_tasks, *adverse_tasks,
            return_exceptions=True,
        )

        n = len(drug_names)
        label_results = all_results[:n]
        adverse_results = all_results[n:]

        drug_info: list[dict[str, Any]] = []
        interaction_warnings: list[str] = []
        adverse_signals: list[dict[str, Any]] = []

        for i, name in enumerate(drug_names):
            # Labels
            labels = label_results[i] if not isinstance(label_results[i], Exception) else []
            if labels and isinstance(labels, list) and labels:
                label = labels[0]
                drug_info.append({
                    "drug_name": name,
                    "generic_name": label.get("generic_name", ""),
                    "brand_names": label.get("brand_names", []),
                    "indications": _truncate(label.get("indications", ""), 500),
                    "warnings": _truncate(label.get("warnings", ""), 500),
                    "boxed_warning": _truncate(label.get("boxed_warning", ""), 300),
                    "drug_interactions": _truncate(label.get("drug_interactions", ""), 500),
                    "contraindications": _truncate(label.get("contraindications", ""), 300),
                })

                # Extract interaction warnings
                interactions_text = label.get("drug_interactions", "")
                if interactions_text:
                    interaction_warnings.append(
                        f"{name}: {_truncate(interactions_text, 300)}"
                    )

            # Adverse events
            events = adverse_results[i] if not isinstance(adverse_results[i], Exception) else []
            if events and isinstance(events, list):
                reactions_seen: set[str] = set()
                for event in events:
                    for rx in event.get("reactions", []):
                        term = rx.get("term", "")
                        if term and term not in reactions_seen:
                            reactions_seen.add(term)
                if reactions_seen:
                    adverse_signals.append({
                        "drug_name": name,
                        "reported_reactions": sorted(reactions_seen)[:10],
                    })

        logger.info(
            "DrugSafety enriched | drugs=%d | labels=%d | adverse=%d",
            len(drug_names), len(drug_info), len(adverse_signals),
        )

        return {
            "drug_info": drug_info,
            "interaction_warnings": interaction_warnings,
            "adverse_event_signals": adverse_signals,
        }


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max length."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "…"
