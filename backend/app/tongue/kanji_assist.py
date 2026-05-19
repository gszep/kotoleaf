import json
import logging
import re
import unicodedata
from pathlib import Path

import fugashi

logger = logging.getLogger(__name__)

_tagger: fugashi.Tagger | None = None
_jlpt_levels: dict[str, int] | None = None

JLPT_THRESHOLD_MAP = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1}

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


def init_tagger() -> None:
    global _tagger
    _tagger = fugashi.Tagger()
    logger.info("MeCab tagger initialized")


def load_jlpt_data() -> None:
    global _jlpt_levels
    jlpt_path = DATA_DIR / "jlpt_kanji.json"
    if jlpt_path.exists():
        with open(jlpt_path) as f:
            _jlpt_levels = json.load(f)
        logger.info(f"Loaded {len(_jlpt_levels)} JLPT kanji entries")
    else:
        _jlpt_levels = {}
        logger.warning(f"JLPT data file not found at {jlpt_path}, using empty lookup")


def _has_kanji(text: str) -> bool:
    return any(
        unicodedata.name(ch, "").startswith("CJK UNIFIED IDEOGRAPH") for ch in text
    )


def _get_jlpt_level(kanji: str) -> int | None:
    """Return JLPT level (1-5) for a kanji character, or None if unknown."""
    if _jlpt_levels is None:
        return None
    return _jlpt_levels.get(kanji)


def _term_max_jlpt_level(surface: str) -> int | None:
    """Return the highest (most difficult = lowest number) JLPT level among kanji in the term."""
    levels = []
    for ch in surface:
        level = _get_jlpt_level(ch)
        if level is not None:
            levels.append(level)
    return min(levels) if levels else None


def add_furigana(
    text: str,
    threshold: str = "N1",
) -> str:
    """Add <ruby> tags for kanji at or above the JLPT threshold.

    Respects MeCab compound boundaries — highlights the full morpheme,
    not individual characters.
    """
    if _tagger is None:
        return text

    threshold_num = JLPT_THRESHOLD_MAP.get(threshold, 1)
    result_parts: list[str] = []

    parsed = _tagger(text)
    for word in parsed:
        surface = word.surface
        if not _has_kanji(surface):
            result_parts.append(surface)
            continue

        level = _term_max_jlpt_level(surface)
        if level is not None and level <= threshold_num:
            reading = getattr(word.feature, "kana", None) or ""
            if reading:
                # Convert katakana reading to hiragana
                reading = _kata_to_hira(reading)
                result_parts.append(
                    f"<ruby>{surface}<rp>(</rp><rt>{reading}</rt><rp>)</rp></ruby>"
                )
            else:
                result_parts.append(surface)
        else:
            result_parts.append(surface)

    return "".join(result_parts)


def _kata_to_hira(text: str) -> str:
    return "".join(
        chr(ord(ch) - 0x60) if "ァ" <= ch <= "ヶ" else ch for ch in text
    )
