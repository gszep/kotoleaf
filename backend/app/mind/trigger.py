import time

from app.models.session import SummarizationConfig
from app.models.transcript import TranscriptSegment


class SummarizationTrigger:
    """Decides when to fire a summarization round based on adaptive thresholds."""

    def __init__(self, config: SummarizationConfig):
        self._config = config
        self._substantive_count = 0
        self._last_trigger_time: float | None = None

    @property
    def config(self) -> SummarizationConfig:
        return self._config

    @config.setter
    def config(self, value: SummarizationConfig) -> None:
        self._config = value

    def check(self, segment: TranscriptSegment) -> bool:
        now = time.monotonic()

        if not segment.is_final:
            return False

        # Cooldown check
        if self._last_trigger_time is not None:
            elapsed = now - self._last_trigger_time
            if elapsed < self._config.cooldown_sec:
                return False

        # Check if utterance is substantive
        word_count = len(segment.text.split())
        duration = segment.end - segment.start
        is_substantive = (
            word_count >= self._config.min_word_count
            or duration >= self._config.min_duration_sec
        )

        if is_substantive:
            self._substantive_count += 1

        # Max interval ceiling — force trigger even without enough utterances
        if self._last_trigger_time is not None:
            elapsed = now - self._last_trigger_time
            if elapsed >= self._config.max_interval_sec:
                if self._substantive_count > 0:
                    self._fire(now)
                    return True

        # Utterance threshold met
        if self._substantive_count >= self._config.utterance_threshold:
            self._fire(now)
            return True

        return False

    def _fire(self, now: float) -> None:
        self._last_trigger_time = now
        self._substantive_count = 0

    def reset(self) -> None:
        self._substantive_count = 0
        self._last_trigger_time = None
