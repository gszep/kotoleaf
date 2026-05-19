from pydantic import BaseModel, Field

SUMMARIZATION_TOOL = {
    "name": "produce_summary",
    "description": (
        "Produce a bilingual rolling summary of the conversation segment, "
        "with clarification detection and kanji assist term pairs."
    ),
    "input_schema": {
        "type": "object",
        "required": ["en_summary", "jp_summary", "is_new"],
        "properties": {
            "en_summary": {
                "type": "string",
                "description": (
                    "English summary with bracket-indexed terms for kanji assist, "
                    "e.g. '{approval process}[1] was discussed'"
                ),
            },
            "jp_summary": {
                "type": "string",
                "description": (
                    "Japanese summary in the specified register with bracket-indexed "
                    "terms and readings, e.g. '{稟議|りんぎ}[1]について話し合いました'"
                ),
            },
            "is_new": {
                "type": "boolean",
                "description": (
                    "True if this segment contains new substantive information. "
                    "False if only backchanneling or aizuchi."
                ),
            },
            "clarifications": {
                "type": "array",
                "description": "Detected clarification moments in this segment.",
                "items": {
                    "type": "object",
                    "required": [
                        "term",
                        "reading",
                        "meaning",
                        "context_sentence",
                        "confidence",
                        "speaker",
                    ],
                    "properties": {
                        "term": {
                            "type": "string",
                            "description": "The likely confusing term (JP surface form)",
                        },
                        "reading": {
                            "type": "string",
                            "description": "Hiragana reading",
                        },
                        "meaning": {
                            "type": "string",
                            "description": "English meaning in context",
                        },
                        "context_sentence": {
                            "type": "string",
                            "description": "The sentence containing the term",
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                            "description": (
                                "Confidence that this is genuine confusion "
                                "vs hedging/politeness"
                            ),
                        },
                        "speaker": {
                            "type": "string",
                            "description": "Speaker label from diarization",
                        },
                        "timestamp_start": {
                            "type": "number",
                            "description": "Start timestamp (seconds)",
                        },
                        "timestamp_end": {
                            "type": "number",
                            "description": "End timestamp (seconds)",
                        },
                    },
                },
            },
            "term_pairs": {
                "type": "array",
                "description": "Bracket-indexed term pairs for kanji assist color-linking.",
                "items": {
                    "type": "object",
                    "required": ["index", "jp_term", "reading", "en_term"],
                    "properties": {
                        "index": {"type": "integer"},
                        "jp_term": {"type": "string"},
                        "reading": {
                            "type": "string",
                            "description": "Hiragana reading",
                        },
                        "en_term": {"type": "string"},
                    },
                },
            },
            "speaker_map": {
                "type": "object",
                "description": (
                    "Mapping of raw Deepgram speaker IDs (as strings) to inferred "
                    "speaker names. If two IDs belong to the same person, map both "
                    'to the same name. Example: {"0": "Grisha", "1": "Tanaka-san", '
                    '"2": "Grisha"}'
                ),
                "additionalProperties": {"type": "string"},
            },
        },
    },
}


class ClarificationDetection(BaseModel):
    term: str
    reading: str
    meaning: str
    context_sentence: str
    confidence: float = Field(ge=0, le=1)
    speaker: str
    timestamp_start: float | None = None
    timestamp_end: float | None = None


class TermPair(BaseModel):
    index: int
    jp_term: str
    reading: str
    en_term: str


class SummaryResult(BaseModel):
    en_summary: str
    jp_summary: str
    is_new: bool
    clarifications: list[ClarificationDetection] = []
    term_pairs: list[TermPair] = []
    speaker_map: dict[str, str] = {}
