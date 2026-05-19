import asyncio
import logging
from collections.abc import Callable

from deepgram import AsyncDeepgramClient

from app.config import settings
from app.models.transcript import TranscriptSegment, Word

logger = logging.getLogger(__name__)


class DeepgramStreamer:
    """Manages a streaming WebSocket connection to Deepgram Nova-3 (SDK v7)."""

    def __init__(
        self,
        on_transcript: Callable[[TranscriptSegment], None],
        on_error: Callable[[Exception], None] | None = None,
    ):
        self._on_transcript = on_transcript
        self._on_error = on_error
        self._connection = None
        self._ctx = None
        self._running = False

    async def start(self) -> None:
        client = AsyncDeepgramClient(api_key=settings.deepgram_api_key)

        self._ctx = client.listen.v1.connect(
            model=settings.deepgram_model,
            language=settings.deepgram_language,
            diarize=True,
            smart_format=True,
            punctuate=True,
            interim_results=True,
            encoding="linear16",
            sample_rate=16000,
            channels=1,
        )
        self._connection = await self._ctx.__aenter__()
        self._running = True
        asyncio.create_task(self._receive_loop())
        logger.info("Deepgram streaming connection started")

    async def send_audio(self, audio_bytes: bytes) -> None:
        if self._connection and self._running:
            try:
                await self._connection.send_media(audio_bytes)
            except Exception as e:
                logger.error("Failed to send audio: %s", e)
                if self._on_error:
                    self._on_error(e)

    async def stop(self) -> None:
        self._running = False
        if self._connection:
            try:
                await self._connection.send_close_stream()
            except Exception:
                pass
        if self._ctx:
            try:
                await self._ctx.__aexit__(None, None, None)
            except Exception:
                pass
            self._ctx = None
            self._connection = None
        logger.info("Deepgram streaming connection stopped")

    async def _receive_loop(self) -> None:
        try:
            while self._running and self._connection:
                try:
                    message = await asyncio.wait_for(
                        self._connection.recv(), timeout=30.0
                    )
                    self._process_message(message)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    if self._running:
                        raise
                    break
        except Exception as e:
            if self._running:
                logger.error("Deepgram receive error: %s", e)
                if self._on_error:
                    self._on_error(e)

    def _process_message(self, message: object) -> None:
        try:
            if not hasattr(message, "channel"):
                return

            channel = message.channel
            if not channel or not channel.alternatives:
                return

            alt = channel.alternatives[0]
            if not alt.transcript:
                return

            words = []
            for w in alt.words:
                words.append(
                    Word(
                        word=w.word,
                        start=w.start,
                        end=w.end,
                        language=getattr(w, "language", ""),
                        confidence=w.confidence,
                        speaker=getattr(w, "speaker", None),
                    )
                )

            speaker = words[0].speaker if words else None
            is_final = getattr(message, "is_final", False)

            segment = TranscriptSegment(
                text=alt.transcript,
                words=words,
                speaker=speaker,
                is_final=is_final,
                start=words[0].start if words else 0.0,
                end=words[-1].end if words else 0.0,
            )

            self._on_transcript(segment)

        except Exception:
            logger.exception("Error processing Deepgram message")
