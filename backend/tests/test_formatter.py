from app.models.summary import SummaryResult
from app.tongue.formatter import _format_bracketed_terms


def test_bracket_parsing_en():
    text = "They discussed {approval process}[1] and {budget}[2]."
    result = _format_bracketed_terms(text, "en")
    assert '<span class="term-pair" data-pair-index="1">approval process</span>' in result
    assert '<span class="term-pair" data-pair-index="2">budget</span>' in result


def test_bracket_parsing_jp_with_reading():
    text = "{稟議|りんぎ}[1]について話し合いました。"
    result = _format_bracketed_terms(text, "jp")
    assert '<span class="term-pair" data-pair-index="1">稟議</span>' in result
    assert "りんぎ" not in result  # reading stripped from bracket syntax


def test_no_brackets():
    text = "No special terms here."
    result = _format_bracketed_terms(text, "en")
    assert result == text
