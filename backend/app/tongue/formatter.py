import re

from app.models.summary import SummaryResult, TermPair
from app.tongue.kanji_assist import add_furigana

# Matches {term}[index] or {term|reading}[index]
BRACKET_PATTERN = re.compile(r"\{([^}|]+)(?:\|([^}]+))?\}\[(\d+)\]")


def format_summary(
    result: SummaryResult,
    jlpt_threshold: str = "N1",
) -> dict:
    """Format a SummaryResult into display-ready HTML for the frontend."""
    en_html = _format_bracketed_terms(result.en_summary, "en")
    jp_html = _format_bracketed_terms(result.jp_summary, "jp")

    # Apply furigana to the JP summary (after bracket stripping)
    jp_html = add_furigana(jp_html, threshold=jlpt_threshold)

    return {
        "en_html": en_html,
        "jp_html": jp_html,
        "is_new": result.is_new,
        "term_pairs": [tp.model_dump() for tp in result.term_pairs],
        "clarifications": [c.model_dump() for c in result.clarifications],
    }


def _format_bracketed_terms(text: str, lang: str) -> str:
    """Replace {term}[N] or {term|reading}[N] with <span data-pair-index="N">."""

    def replace_match(m: re.Match) -> str:
        term = m.group(1)
        index = m.group(3)
        return f'<span class="term-pair" data-pair-index="{index}">{term}</span>'

    return BRACKET_PATTERN.sub(replace_match, text)
