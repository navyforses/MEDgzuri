"""Response enhancement service — executive summary, comparison table, action steps.

Enriches pipeline results with:
  - Executive summary (3-sentence, via Claude Haiku for speed)
  - Treatment comparison table
  - Concrete action steps for the patient
  - Georgia/regional availability assessment
"""

import json
import logging
from typing import Any

from app.services.llm_client import call_haiku, call_haiku_json

logger = logging.getLogger(__name__)


# ═══════════════ EXECUTIVE SUMMARY ═══════════════

async def generate_summary(results: list[dict[str, Any]], query: str) -> str:
    """Generate a 3-sentence executive summary of search results in Georgian.

    Uses Claude Haiku for speed. Returns empty string on failure.
    """
    if not results:
        return ""

    # Build concise input from top results
    top_items = results[:5]
    items_text = "\n".join(
        f"- {r.get('title', '')}: {(r.get('body', '') or r.get('abstract_summary', ''))[:200]}"
        for r in top_items
    )

    system = (
        "შენ ხარ მედგზურის სამედიცინო ასისტენტი. დაწერე ზუსტად 3 წინადადებიანი შეჯამება "
        "ძიების შედეგების საფუძველზე. პირველი წინადადება — რა მოიძებნა. მეორე — ყველაზე "
        "მნიშვნელოვანი მიგნება. მესამე — რეკომენდაცია.\n\n"
        "წესები:\n"
        "- მხოლოდ ქართული ენა\n"
        "- ზუსტად 3 წინადადება, არც მეტი\n"
        "- არ დაასახელო დიაგნოზი\n"
        "- არ გამოიყენო მეტა-ტექსტი (\"აქ არის...\", \"ეს შეჯამება...\")\n"
        "- პასუხი: მხოლოდ 3 წინადადება, არანაირი დამატებითი ტექსტი"
    )

    user_msg = f"მოთხოვნა: {query}\n\nშედეგები:\n{items_text}"

    try:
        text = await call_haiku(system, user_msg, max_tokens=500)
        # Clean up — remove any quotes or extra whitespace
        text = text.strip().strip('"')
        return text
    except Exception as e:
        logger.warning("Summary generation failed: %s", str(e)[:100])
        return ""


# ═══════════════ COMPARISON TABLE ═══════════════

async def generate_comparison(
    results: list[dict[str, Any]],
    query: str,
) -> dict[str, Any] | None:
    """Generate a treatment comparison table from search results.

    Returns dict with 'headers' and 'rows', or None if not applicable.
    Only generates comparison when multiple treatments are found.
    """
    # Filter for treatment-related results
    treatment_results = [
        r for r in results
        if _is_treatment_related(r)
    ]

    if len(treatment_results) < 2:
        return None

    items_json = json.dumps(
        [
            {
                "title": r.get("title", ""),
                "body": (r.get("body", "") or r.get("abstract_summary", ""))[:300],
                "source": r.get("source", ""),
            }
            for r in treatment_results[:6]
        ],
        ensure_ascii=False,
    )

    system = (
        "შენ ხარ მედგზურის სამედიცინო ასისტენტი. შექმენი მკურნალობის ვარიანტების შედარების ცხრილი.\n\n"
        "პასუხი JSON ფორმატში:\n"
        '{"headers": ["მკურნალობა", "ეფექტურობა", "გვერდითი მოვლენები", "სავარაუდო ღირებულება", "ხელმისაწვდომობა"], '
        '"rows": [["მკურნალობა 1", "აღწერა", "აღწერა", "₾X–Y", "საქართველო/თურქეთი"], ...]}\n\n'
        "წესები:\n"
        "- მხოლოდ ქართული ენა (გარდა სამედიცინო ტერმინებისა)\n"
        "- ფასები ლარში (₾) ან დოლარში ($)\n"
        "- ხელმისაწვდომობა: საქართველო, თურქეთი, ევროპა, ან სხვა\n"
        "- მხოლოდ JSON, სხვა ტექსტი არ არის საჭირო"
    )

    user_msg = f"მოთხოვნა: {query}\n\nმკურნალობის ვარიანტები:\n{items_json}"

    try:
        parsed = await call_haiku_json(system, user_msg, max_tokens=1500)
        if parsed and parsed.get("headers") and parsed.get("rows"):
            return {"headers": parsed["headers"], "rows": parsed["rows"]}
        return None
    except Exception as e:
        logger.warning("Comparison generation failed: %s", str(e)[:100])
        return None


# ═══════════════ ACTION STEPS ═══════════════

async def generate_action_steps(
    results: list[dict[str, Any]],
    query: str,
) -> list[str]:
    """Generate concrete 'what should the patient do next' steps in Georgian.

    Returns list of action step strings, or empty list on failure.
    """
    if not results:
        return []

    top_items = results[:5]
    items_text = "\n".join(
        f"- {r.get('title', '')}: {(r.get('body', '') or r.get('abstract_summary', ''))[:150]}"
        for r in top_items
    )

    system = (
        "შენ ხარ მედგზურის სამედიცინო ასისტენტი. დაწერე 3-5 კონკრეტული ნაბიჯი, რა უნდა "
        "გააკეთოს პაციენტმა შემდეგ.\n\n"
        "პასუხი JSON ფორმატში:\n"
        '{"steps": ["ნაბიჯი 1", "ნაბიჯი 2", ...]}\n\n'
        "წესები:\n"
        "- მხოლოდ ქართული ენა\n"
        "- კონკრეტული, აქციონერული ნაბიჯები\n"
        "- არ დაასახელო დიაგნოზი\n"
        "- პირველი ნაბიჯი ყოველთვის: ექიმთან კონსულტაცია\n"
        "- მხოლოდ JSON"
    )

    user_msg = f"მოთხოვნა: {query}\n\nშედეგები:\n{items_text}"

    try:
        parsed = await call_haiku_json(system, user_msg, max_tokens=800)
        if parsed and parsed.get("steps"):
            return parsed["steps"][:5]
        return []
    except Exception as e:
        logger.warning("Action steps generation failed: %s", str(e)[:100])
        return []


# ═══════════════ REGIONAL AVAILABILITY ═══════════════

async def assess_regional_availability(
    results: list[dict[str, Any]],
    query: str,
) -> dict[str, str]:
    """For each treatment, assess availability in Georgia/Turkey/region.

    Returns dict mapping treatment name → availability note in Georgian.
    """
    treatment_results = [r for r in results if _is_treatment_related(r)]
    if not treatment_results:
        return {}

    treatments = [r.get("title", "") for r in treatment_results[:6] if r.get("title")]
    if not treatments:
        return {}

    system = (
        "შენ ხარ მედგზურის სამედიცინო ასისტენტი. შეაფასე თითოეული მკურნალობის ხელმისაწვდომობა "
        "საქართველოში, თურქეთსა და რეგიონში.\n\n"
        "პასუხი JSON ფორმატში:\n"
        '{"availability": {"მკურნალობა 1": "ხელმისაწვდომია საქართველოში", ...}}\n\n'
        "წესები:\n"
        "- მხოლოდ ქართული ენა\n"
        "- მოკლე, 1-2 წინადადება თითოეულისთვის\n"
        "- მიუთითე: საქართველო, თურქეთი, ისრაელი, ევროპა\n"
        "- თუ არ იცი — დაწერე \"საჭიროა დაზუსტება ექიმთან\"\n"
        "- მხოლოდ JSON"
    )

    user_msg = f"მოთხოვნა: {query}\n\nმკურნალობის ვარიანტები: {json.dumps(treatments, ensure_ascii=False)}"

    try:
        parsed = await call_haiku_json(system, user_msg, max_tokens=1000)
        if parsed and parsed.get("availability"):
            return parsed["availability"]
        return {}
    except Exception as e:
        logger.warning("Regional availability assessment failed: %s", str(e)[:100])
        return {}


# ═══════════════ FULL ENHANCEMENT ═══════════════

async def enhance_response(
    results: list[dict[str, Any]],
    query: str,
) -> dict[str, Any]:
    """Run all enhancements and return enrichment data.

    Returns dict with:
      - executive_summary: str
      - comparison_table: dict | None
      - action_steps: list[str]
      - regional_availability: dict[str, str]

    Each component is independent — failure in one doesn't affect others.
    """
    import asyncio

    # Run all enhancements concurrently
    summary_task = asyncio.create_task(_safe(generate_summary(results, query), ""))
    comparison_task = asyncio.create_task(_safe(generate_comparison(results, query), None))
    steps_task = asyncio.create_task(_safe(generate_action_steps(results, query), []))
    availability_task = asyncio.create_task(_safe(assess_regional_availability(results, query), {}))

    summary, comparison, steps, availability = await asyncio.gather(
        summary_task, comparison_task, steps_task, availability_task,
    )

    return {
        "executive_summary": summary,
        "comparison_table": comparison,
        "action_steps": steps,
        "regional_availability": availability,
    }


# ═══════════════ HELPERS ═══════════════

def _is_treatment_related(result: dict[str, Any]) -> bool:
    """Heuristic check if a result is about a treatment/intervention."""
    text = (
        f"{result.get('title', '')} {result.get('body', '')} "
        f"{result.get('abstract_summary', '')} {' '.join(result.get('tags', []))}"
    ).lower()

    treatment_keywords = [
        "treatment", "therapy", "intervention", "drug", "medication",
        "მკურნალობა", "თერაპია", "წამალი", "მედიკამენტი", "პრეპარატი",
        "surgical", "ქირურგიული", "procedure", "პროცედურა",
    ]
    return any(kw in text for kw in treatment_keywords)


async def _safe(coro: Any, default: Any) -> Any:
    """Run a coroutine and return default on any exception."""
    try:
        return await coro
    except Exception as e:
        logger.debug("Enhancement sub-task failed: %s", str(e)[:100])
        return default
