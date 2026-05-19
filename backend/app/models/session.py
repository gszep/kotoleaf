from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Register(StrEnum):
    WORKPLACE_POLITE = "workplace_polite"
    FORMAL = "formal"
    CASUAL = "casual"


class AudioSource(StrEnum):
    MICROPHONE = "microphone"
    SCREEN_SHARE = "screen_share"


class SessionStatus(StrEnum):
    ACTIVE = "active"
    ENDED = "ended"


class SummarizationConfig(BaseModel):
    utterance_threshold: int = 2
    min_word_count: int = 3
    min_duration_sec: float = 1.5
    max_interval_sec: float = 30.0
    cooldown_sec: float = 5.0


class Session(BaseModel):
    id: str
    created_by: str
    participants: list[str] = Field(max_length=2)
    register: Register = Register.WORKPLACE_POLITE
    audio_source: AudioSource = AudioSource.MICROPHONE
    status: SessionStatus = SessionStatus.ACTIVE
    summarization_config: SummarizationConfig = Field(
        default_factory=SummarizationConfig
    )
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: datetime | None = None
    rating: int | None = Field(default=None, ge=1, le=5)


class CreateSessionRequest(BaseModel):
    register: Register = Register.WORKPLACE_POLITE
    audio_source: AudioSource = AudioSource.MICROPHONE
    summarization_config: SummarizationConfig = Field(
        default_factory=SummarizationConfig
    )
