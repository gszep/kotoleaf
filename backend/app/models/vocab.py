from datetime import datetime

from pydantic import BaseModel, Field


class Encounter(BaseModel):
    id: str = ""
    term: str
    reading: str
    meaning: str
    context_sentence: str
    confidence: float = Field(ge=0, le=1)
    speaker: str
    session_id: str
    audio_snippet_url: str | None = None
    timestamp: float = 0.0
    encounter_count: int = 1
    first_seen: datetime = Field(default_factory=datetime.utcnow)
    last_seen: datetime = Field(default_factory=datetime.utcnow)
