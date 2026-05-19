import time

from app.models.transcript import TranscriptSegment


class TranscriptBuffer:
    """Maintains a rolling window of final transcript segments."""

    def __init__(self, window_sec: float = 30.0):
        self._window_sec = window_sec
        self._segments: list[TranscriptSegment] = []

    def add(self, segment: TranscriptSegment) -> None:
        if not segment.is_final:
            return
        self._segments.append(segment)
        self._prune()

    def get_window(self) -> list[TranscriptSegment]:
        self._prune()
        return list(self._segments)

    def get_text(self) -> str:
        lines = []
        for seg in self.get_window():
            speaker = f"Speaker {seg.speaker}" if seg.speaker is not None else "Speaker"
            lines.append(f"[{speaker}]: {seg.text}")
        return "\n".join(lines)

    def clear(self) -> None:
        self._segments.clear()

    def _prune(self) -> None:
        if not self._segments:
            return
        latest = self._segments[-1].end
        cutoff = latest - self._window_sec
        self._segments = [s for s in self._segments if s.end > cutoff]
