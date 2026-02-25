"""Async Anthropic API wrapper with retry, logging, and JSON extraction."""

import asyncio
import json
import logging
import time
from pathlib import Path

import anthropic
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Singleton client — initialized lazily
_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=httpx.Timeout(settings.llm_timeout_seconds, connect=10.0),
        )
    return _client


def load_prompt(name: str) -> str:
    """Load a prompt template from app/prompts/{name}.txt."""
    prompt_path = Path(__file__).parent.parent / "prompts" / f"{name}.txt"
    return prompt_path.read_text(encoding="utf-8")


async def call_sonnet(
    system: str,
    user_message: str,
    max_tokens: int = 3000,
) -> str:
    """Call Claude Sonnet and return raw text response."""
    return await _call_model(settings.claude_sonnet_model, system, user_message, max_tokens)


async def call_opus(
    system: str,
    user_message: str,
    max_tokens: int = 4000,
) -> str:
    """Call Claude Opus and return raw text response."""
    return await _call_model(settings.claude_opus_model, system, user_message, max_tokens)


async def _call_model(
    model: str,
    system: str,
    user_message: str,
    max_tokens: int,
) -> str:
    """Call a Claude model with retry logic and logging."""
    client = _get_client()
    last_error = None

    max_attempts = settings.llm_max_retries + 1

    hard_timeout = settings.llm_timeout_seconds

    for attempt in range(1, max_attempts + 1):
        start = time.monotonic()
        try:
            response = await asyncio.wait_for(
                client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user_message}],
                ),
                timeout=hard_timeout,
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)
            text = response.content[0].text if response.content else ""
            usage = response.usage
            logger.info(
                "LLM OK | model=%s | tokens_in=%d tokens_out=%d | %dms",
                model, usage.input_tokens, usage.output_tokens, elapsed_ms,
            )
            return text

        except asyncio.TimeoutError:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "LLM timeout | model=%s | %dms (hard limit %ds) — no retry",
                model, elapsed_ms, hard_timeout,
            )
            raise TimeoutError(f"LLM timeout after {elapsed_ms}ms")

        except anthropic.APIStatusError as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "LLM error | model=%s | status=%d | attempt=%d/%d | %dms | %s",
                model, e.status_code, attempt, max_attempts,
                elapsed_ms, str(e)[:200],
            )
            last_error = e
            if e.status_code in (429, 500, 502, 503) and attempt < max_attempts:
                continue
            raise

        except (anthropic.APITimeoutError, anthropic.APIConnectionError) as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "LLM connection error | model=%s | attempt=%d/%d | %dms",
                model, attempt, max_attempts, elapsed_ms,
            )
            last_error = e
            if attempt < max_attempts:
                continue
            raise

    raise last_error or RuntimeError("LLM call failed after all retries")


async def call_sonnet_json(
    system: str,
    user_message: str,
    max_tokens: int = 3000,
) -> dict | None:
    """Call Sonnet and parse the response as JSON."""
    text = await call_sonnet(system, user_message, max_tokens)
    return extract_json(text)


async def call_opus_json(
    system: str,
    user_message: str,
    max_tokens: int = 4000,
) -> dict | None:
    """Call Opus and parse the response as JSON."""
    text = await call_opus(system, user_message, max_tokens)
    return extract_json(text)


def extract_json(text: str) -> dict | None:
    """Extract a valid JSON object from potentially messy LLM output.

    Strategies (in order):
      1. Code fence (```json {...} ```)
      2. Full text as JSON
      3. Balanced-brace extraction
    """
    import re

    # Strategy 1: code fence
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if fence:
        result = _try_parse(fence.group(1))
        if result is not None:
            return result

    # Strategy 2: full text
    trimmed = text.strip()
    if trimmed.startswith("{"):
        result = _try_parse(trimmed)
        if result is not None:
            return result

    # Strategy 3: balanced braces
    return _extract_balanced(text)


def _try_parse(s: str) -> dict | None:
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    return None


def _extract_balanced(text: str) -> dict | None:
    pos = 0
    while pos < len(text):
        start = text.find("{", pos)
        if start == -1:
            break
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\" and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    result = _try_parse(text[start:i + 1])
                    if result is not None:
                        return result
                    pos = i + 1
                    break
        else:
            break
    return None
