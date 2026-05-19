import json
import logging
import time

import anthropic

from app.config import settings
from app.mind.context import build_system_prompt
from app.models.session import Register
from app.models.summary import SUMMARIZATION_TOOL, SummaryResult

logger = logging.getLogger(__name__)

OUTPUT_SCHEMA = json.dumps(SUMMARIZATION_TOOL["input_schema"], indent=2)

EXAMPLE_OUTPUT = json.dumps(
    {
        "en_summary": "Speaker 0 proposes moving the Q3 report deadline. Speaker 1 says an {approval process}[1] is needed, making the timeline tight.",
        "jp_summary": "Speaker 0がQ3レポートの締め切り変更を提案。Speaker 1は{稟議|りんぎ}[1]が必要なため、厳しいかもしれないと回答。",
        "is_new": True,
        "clarifications": [
            {
                "term": "稟議",
                "reading": "りんぎ",
                "meaning": "formal approval process",
                "context_sentence": "稟議を通す必要があるので",
                "confidence": 0.85,
                "speaker": "Speaker 0",
                "timestamp_start": None,
                "timestamp_end": None,
            }
        ],
        "term_pairs": [
            {"index": 1, "jp_term": "稟議", "reading": "りんぎ", "en_term": "approval process"}
        ],
    },
    ensure_ascii=False,
    indent=2,
)

JSON_INSTRUCTION = f"""Respond with ONLY a JSON object matching this schema — no markdown, no explanation, no wrapping:

{OUTPUT_SCHEMA}

Example:
{EXAMPLE_OUTPUT}"""


class Summarizer:
    def __init__(self) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._model = settings.anthropic_model

    async def summarize(
        self,
        transcript_text: str,
        register: Register,
        meeting_context: str = "",
    ) -> SummaryResult | None:
        system_prompt = build_system_prompt(register, meeting_context)
        system_with_schema = f"{system_prompt}\n\n{JSON_INSTRUCTION}"

        t0 = time.monotonic()
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": system_with_schema,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[
                    {
                        "role": "user",
                        "content": f"Transcript segment:\n\n{transcript_text}",
                    }
                ],
            )
            elapsed = time.monotonic() - t0
            logger.info(
                "Claude API: %.1fs, in=%d out=%d cache_read=%d cache_create=%d",
                elapsed,
                response.usage.input_tokens,
                response.usage.output_tokens,
                getattr(response.usage, "cache_read_input_tokens", 0) or 0,
                getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
            )

            text = ""
            for block in response.content:
                if block.type == "text":
                    text += block.text

            return self._extract_json(text)

        except anthropic.APIError as e:
            elapsed = time.monotonic() - t0
            logger.error("Anthropic API error (%.1fs): %s", elapsed, e)
            return None

    def _extract_json(self, text: str) -> SummaryResult | None:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            first_newline = cleaned.index("\n") if "\n" in cleaned else 3
            cleaned = cleaned[first_newline + 1 :]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        try:
            start = cleaned.index("{")
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(cleaned, idx=start)
            return SummaryResult.model_validate(obj)
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning("Failed to parse JSON from response: %s\nText: %s", e, text[:300])
            return None
        except Exception as e:
            logger.error("Failed to validate summary: %s", e)
            return None
