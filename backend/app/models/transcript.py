from pydantic import BaseModel


class Word(BaseModel):
    word: str
    start: float
    end: float
    language: str = ""
    confidence: float = 0.0
    speaker: int | None = None


class TranscriptSegment(BaseModel):
    text: str
    words: list[Word]
    speaker: int | None = None
    is_final: bool = False
    start: float = 0.0
    end: float = 0.0
