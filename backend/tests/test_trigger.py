import time
from unittest.mock import patch

from app.mind.trigger import SummarizationTrigger
from app.models.session import SummarizationConfig
from app.models.transcript import TranscriptSegment


def _segment(text: str, start: float = 0.0, end: float = 5.0, is_final: bool = True) -> TranscriptSegment:
    return TranscriptSegment(
        text=text, words=[], speaker=0, is_final=is_final, start=start, end=end
    )


def test_trigger_fires_after_threshold():
    trigger = SummarizationTrigger(SummarizationConfig(utterance_threshold=3))
    assert not trigger.check(_segment("Hello there my friend"))
    assert not trigger.check(_segment("How are you doing today"))
    assert trigger.check(_segment("Let us discuss the project"))


def test_trigger_ignores_non_final():
    trigger = SummarizationTrigger(SummarizationConfig(utterance_threshold=1))
    assert not trigger.check(_segment("Hello there my friend", is_final=False))


def test_trigger_ignores_short_utterances():
    trigger = SummarizationTrigger(
        SummarizationConfig(utterance_threshold=2, min_word_count=5, min_duration_sec=3.0)
    )
    # "Hi" is too short (1 word, but end-start might be > 3s by default)
    short = _segment("Hi", start=0.0, end=1.0)
    assert not trigger.check(short)
    assert not trigger.check(short)
    assert not trigger.check(short)


def test_trigger_respects_cooldown():
    trigger = SummarizationTrigger(
        SummarizationConfig(utterance_threshold=1, cooldown_sec=0.5)
    )
    assert trigger.check(_segment("Hello there my friend"))
    # Immediately after — should be in cooldown
    assert not trigger.check(_segment("Another substantive sentence here"))


def test_trigger_max_interval_ceiling():
    config = SummarizationConfig(
        utterance_threshold=100,  # very high, won't trigger normally
        max_interval_sec=0.01,   # very short ceiling
        cooldown_sec=0.0,
    )
    trigger = SummarizationTrigger(config)
    # First call triggers (threshold=100, but no last_trigger_time yet so ceiling doesn't apply)
    # We need to manually set _last_trigger_time to simulate a previous trigger
    trigger._last_trigger_time = time.monotonic()
    trigger._substantive_count = 1  # has at least one substantive utterance
    time.sleep(0.02)
    assert trigger.check(_segment("Second substantive utterance here"))


def test_trigger_reset():
    trigger = SummarizationTrigger(SummarizationConfig(utterance_threshold=2))
    trigger.check(_segment("Hello there my friend"))
    trigger.reset()
    assert not trigger.check(_segment("Just one more sentence here"))
