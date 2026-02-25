#!/usr/bin/env python3
"""Real API verification script — run outside sandbox with actual API keys.

Usage:
  1. Fill in ANTHROPIC_API_KEY (and optionally NCBI_API_KEY) in .env
  2. Run: python scripts/verify_apis.py

Steps:
  Step 1: Verify .env configuration
  Step 2: Test ClinicalTrials.gov API (no key required)
  Step 3: Test PubMed API (NCBI_API_KEY optional)
  Step 4: Full Pipeline A test (requires ANTHROPIC_API_KEY)
  Step 5: Pipeline C test
  Step 6: Pipeline B test
"""

import asyncio
import json
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def step_header(n: int, title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  Step {n}: {title}")
    print(f"{'='*60}\n")


def ok(msg: str) -> None:
    print(f"  ✅ {msg}")


def fail(msg: str) -> None:
    print(f"  ❌ {msg}")


def info(msg: str) -> None:
    print(f"  ℹ️  {msg}")


async def step1_verify_env():
    step_header(1, "Verify .env Configuration")
    from app.config import settings

    if settings.anthropic_api_key:
        ok(f"ANTHROPIC_API_KEY: set ({settings.anthropic_api_key[:10]}...)")
    else:
        fail("ANTHROPIC_API_KEY: NOT SET — Pipeline tests will fail!")
        return False

    if settings.ncbi_api_key:
        ok(f"NCBI_API_KEY: set ({settings.ncbi_api_key[:8]}...)")
    else:
        info("NCBI_API_KEY: not set (optional, but rate limits apply)")

    ok(f"Sonnet model: {settings.claude_sonnet_model}")
    ok(f"Opus model: {settings.claude_opus_model}")
    ok(f"Demo mode: {settings.is_demo_mode}")

    return True


async def step2_test_clinicaltrials():
    step_header(2, "Test ClinicalTrials.gov API")
    from app.integrations.clinicaltrials_gov import ClinicalTrialsClient

    client = ClinicalTrialsClient()
    info("Searching: 'lung cancer' (recruiting, worldwide)")
    results = await client.search("lung cancer", max_results=5)

    if results:
        ok(f"Got {len(results)} studies")
        for r in results[:3]:
            print(f"    - [{r['nct_id']}] {r['title'][:60]}... ({r['status']})")
        return True
    else:
        fail("No results returned — check network connectivity")
        return False


async def step3_test_pubmed():
    step_header(3, "Test PubMed API")
    from app.integrations.pubmed import PubMedClient

    client = PubMedClient()
    info("Searching: 'NSCLC immunotherapy' (last 3 years)")
    results = await client.search("NSCLC immunotherapy", max_results=5, years_back=3)

    if results:
        ok(f"Got {len(results)} articles")
        for r in results[:3]:
            year = r.get('year', 'N/A')
            print(f"    - [PMID:{r['pmid']}] {r['title'][:50]}... ({year})")
        return True
    else:
        fail("No results returned — check network / NCBI_API_KEY")
        return False


async def step4_pipeline_a():
    step_header(4, "Full Pipeline A: Research Search")
    from app.orchestrator.schemas import ResearchInput
    from app.pipelines.research import ResearchPipeline

    pipeline = ResearchPipeline()
    inp = ResearchInput(
        diagnosis="ფილტვის კიბოს იმუნოთერაპია",
        geography="europe",
        study_type="all",
    )
    info(f"Input: diagnosis='{inp.diagnosis}' geography='{inp.geography}'")

    result = await pipeline.execute(inp)

    if result.items:
        ok(f"Pipeline A complete: {len(result.items)} items")
        ok(f"Meta: {result.meta[:80]}")
        for item in result.items[:3]:
            print(f"    - {item.title[:60]}...")
            if item.tags:
                tags = ", ".join(item.tags[:3])
                print(f"      Tags: {tags}")
        if result.disclaimer:
            ok(f"Disclaimer present: {result.disclaimer[:50]}...")
        return True
    else:
        fail(f"No items returned. Meta: {result.meta}")
        return False


async def step5_pipeline_c():
    step_header(5, "Pipeline C: Clinic Search")
    from app.orchestrator.schemas import ClinicInput
    from app.pipelines.clinics import ClinicPipeline

    pipeline = ClinicPipeline()
    inp = ClinicInput(
        diagnosis_or_treatment="თავის ტვინის სიმსივნე",
        preferred_countries=["germany"],
    )
    info(f"Input: treatment='{inp.diagnosis_or_treatment}' countries={inp.preferred_countries}")

    result = await pipeline.execute(inp)

    if result.items:
        ok(f"Pipeline C complete: {len(result.items)} items")
        ok(f"Meta: {result.meta[:80]}")
        for item in result.items[:3]:
            print(f"    - {item.title[:50]} | {item.source}")
        if result.comparison:
            ok(f"Comparison table: {len(result.comparison.rows)} rows")
        return True
    else:
        fail(f"No items returned. Meta: {result.meta}")
        return False


async def step6_pipeline_b():
    step_header(6, "Pipeline B: Symptom Navigation")
    from app.orchestrator.schemas import SymptomsInput
    from app.pipelines.symptoms import SymptomPipeline

    pipeline = SymptomPipeline()
    inp = SymptomsInput(
        symptoms_text="თავის ტკივილი და მხედველობის დაბინდვა",
        age=45,
        sex="male",
    )
    info(f"Input: symptoms='{inp.symptoms_text}' age={inp.age}")

    result = await pipeline.execute(inp)

    if result.items:
        ok(f"Pipeline B complete: {len(result.items)} items")
        ok(f"Meta: {result.meta[:80]}")
        for item in result.items[:3]:
            print(f"    - {item.title[:60]}")
        if result.disclaimer:
            ok(f"Disclaimer present: {result.disclaimer[:50]}...")
        return True
    else:
        fail(f"No items returned. Meta: {result.meta}")
        return False


async def main():
    print("\n🏥 MedGzuri Backend — Real API Verification")
    print("=" * 60)

    results = {}

    # Step 1: Verify env
    results[1] = await step1_verify_env()
    if not results[1]:
        print("\n⚠️  ANTHROPIC_API_KEY is required for pipeline tests.")
        print("   Fill in .env and re-run this script.")
        print("   Steps 2-3 (external APIs) may still work without it.\n")

    # Step 2: ClinicalTrials.gov
    results[2] = await step2_test_clinicaltrials()

    # Step 3: PubMed
    results[3] = await step3_test_pubmed()

    if not results.get(1):
        print("\n⚠️  Skipping pipeline tests (no ANTHROPIC_API_KEY)")
        results[4] = results[5] = results[6] = False
    else:
        # Step 4: Pipeline A
        results[4] = await step4_pipeline_a()

        # Step 5: Pipeline C
        results[5] = await step5_pipeline_c()

        # Step 6: Pipeline B
        results[6] = await step6_pipeline_b()

    # Summary
    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for step_n, passed in sorted(results.items()):
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  Step {step_n}: {status}")

    total_passed = sum(1 for v in results.values() if v)
    total = len(results)
    print(f"\n  {total_passed}/{total} steps passed")
    print(f"{'='*60}\n")

    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    asyncio.run(main())
