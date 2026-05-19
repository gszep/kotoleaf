import logging
import uuid
from datetime import datetime

from app.ear.audio_buffer import AudioBuffer
from app.models.summary import ClarificationDetection
from app.models.vocab import Encounter

logger = logging.getLogger(__name__)


def process_clarifications(
    detections: list[ClarificationDetection],
    session_id: str,
    audio_buffer: AudioBuffer,
) -> list[tuple[Encounter, bytes | None]]:
    """Convert clarification detections into encounter records with audio clips."""
    results = []
    for det in detections:
        audio_clip = None
        if det.timestamp_start is not None and det.timestamp_end is not None:
            padding = 1.0
            audio_clip = audio_buffer.clip(
                det.timestamp_start - padding,
                det.timestamp_end + padding,
            )

        encounter = Encounter(
            id=uuid.uuid4().hex,
            term=det.term,
            reading=det.reading,
            meaning=det.meaning,
            context_sentence=det.context_sentence,
            confidence=det.confidence,
            speaker=det.speaker,
            session_id=session_id,
            timestamp=det.timestamp_start or 0.0,
            first_seen=datetime.utcnow(),
            last_seen=datetime.utcnow(),
        )
        results.append((encounter, audio_clip))

    return results
