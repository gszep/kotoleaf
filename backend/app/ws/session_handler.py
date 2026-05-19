import asyncio
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

from app.db.sessions import save_speaker_map, save_summary
from app.db.vocab import save_encounter
from app.ear.audio_buffer import AudioBuffer
from app.ear.deepgram_client import DeepgramStreamer
from app.ear.transcript_buffer import TranscriptBuffer
from app.mind.clarification import process_clarifications
from app.mind.summarizer import Summarizer
from app.mind.trigger import SummarizationTrigger
from app.models.session import Register, SummarizationConfig
from app.models.transcript import TranscriptSegment
from app.tongue.formatter import format_summary

logger = logging.getLogger(__name__)


class SessionHandler:
    """Manages a single meeting session over WebSocket.

    Connects the Ear (Deepgram), Mind (Claude), and Tongue (formatter) layers.
    """

    def __init__(
        self,
        websocket: WebSocket,
        session_id: str,
        user_id: str,
        register: Register = Register.WORKPLACE_POLITE,
        config: SummarizationConfig | None = None,
        jlpt_threshold: str = "N1",
    ):
        self._ws = websocket
        self._session_id = session_id
        self._user_id = user_id
        self._register = register
        self._jlpt_threshold = jlpt_threshold

        self._transcript_buffer = TranscriptBuffer()
        self._audio_buffer = AudioBuffer()
        self._trigger = SummarizationTrigger(config or SummarizationConfig())
        self._summarizer = Summarizer()
        self._deepgram: DeepgramStreamer | None = None
        self._summarizing = False
        self._speaker_map: dict[str, str] = {}
        self._user_overrides: set[str] = set()

    async def run(self) -> None:
        self._deepgram = DeepgramStreamer(
            on_transcript=self._handle_transcript,
            on_error=self._handle_deepgram_error,
        )

        try:
            await self._deepgram.start()
            await self._send_status("listening")

            while True:
                data = await self._ws.receive()

                if data.get("bytes"):
                    audio_bytes = data["bytes"]
                    self._audio_buffer.append(audio_bytes, time.monotonic())
                    await self._deepgram.send_audio(audio_bytes)

                elif data.get("text"):
                    await self._handle_control_message(data["text"])

        except WebSocketDisconnect:
            logger.info(f"Session {self._session_id} disconnected")
        except Exception:
            logger.exception(f"Session {self._session_id} error")
        finally:
            if self._deepgram:
                await self._deepgram.stop()

    def _handle_transcript(self, segment: TranscriptSegment) -> None:
        self._transcript_buffer.add(segment)

        raw_id = str(segment.speaker) if segment.speaker is not None else ""
        speaker = self._speaker_map.get(raw_id, f"Speaker {segment.speaker}" if segment.speaker is not None else "Speaker")
        final_tag = "FINAL" if segment.is_final else "interim"
        logger.info(f"[{final_tag}] [{speaker}] {segment.text}")

        asyncio.create_task(self._send_json({
            "type": "transcript",
            "text": segment.text,
            "speaker": speaker,
            "is_final": segment.is_final,
            "words": [w.model_dump() for w in segment.words],
        }))

        if self._trigger.check(segment) and not self._summarizing:
            logger.info(f"[TRIGGER] Summarization triggered — buffer:\n{self._transcript_buffer.get_text(self._speaker_map)}")
            asyncio.create_task(self._run_summarization())

    async def _run_summarization(self) -> None:
        self._summarizing = True
        try:
            transcript_text = self._transcript_buffer.get_text(self._speaker_map)
            if not transcript_text.strip():
                return

            await self._send_status("processing")

            display_map = {
                raw_id: f"{name} *" if raw_id in self._user_overrides else name
                for raw_id, name in self._speaker_map.items()
            } or None

            result = await self._summarizer.summarize(
                transcript_text=transcript_text,
                register=self._register,
                speaker_map=display_map,
            )

            if result is None:
                return

            if self._merge_speaker_map(result.speaker_map):
                await self._broadcast_speaker_map()

            formatted = format_summary(result, self._jlpt_threshold)

            summary_id = await save_summary(self._session_id, {
                "en_text": formatted["en_html"],
                "jp_text": formatted["jp_html"],
                "term_pairs": formatted["term_pairs"],
            })

            send_task = self._send_json({
                "type": "summary",
                "summary_id": summary_id,
                **formatted,
            })

            async def _save_clarifications() -> None:
                if not result.clarifications:
                    return
                encounters = process_clarifications(
                    result.clarifications,
                    self._session_id,
                    self._audio_buffer,
                )
                for encounter, audio_clip in encounters:
                    await save_encounter(self._user_id, encounter)

            await asyncio.gather(send_task, _save_clarifications())

        except Exception:
            logger.exception("Summarization error")
        finally:
            self._summarizing = False
            await self._send_status("listening")

    async def _handle_control_message(self, text: str) -> None:
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type")

        if msg_type == "update_register":
            register = msg.get("register")
            if register and register in Register.__members__.values():
                self._register = Register(register)

        elif msg_type == "update_thresholds":
            config_data = msg.get("config", {})
            current = self._trigger.config.model_dump()
            current.update(config_data)
            self._trigger.config = SummarizationConfig(**current)

        elif msg_type == "update_speaker":
            raw_id = str(msg.get("speaker_id", ""))
            name = msg.get("name", "").strip()
            if raw_id and name:
                self._speaker_map[raw_id] = name
                self._user_overrides.add(raw_id)
                await self._broadcast_speaker_map()

        elif msg_type == "end_session":
            if self._deepgram:
                await self._deepgram.stop()

    def _merge_speaker_map(self, claude_map: dict[str, str]) -> bool:
        changed = False
        for raw_id, name in claude_map.items():
            if raw_id in self._user_overrides:
                continue
            if self._speaker_map.get(raw_id) != name:
                self._speaker_map[raw_id] = name
                changed = True
        return changed

    async def _broadcast_speaker_map(self) -> None:
        await self._send_json({
            "type": "speaker_map",
            "speaker_map": self._speaker_map,
        })
        asyncio.create_task(save_speaker_map(self._session_id, self._speaker_map))

    def _handle_deepgram_error(self, error: Exception) -> None:
        logger.error(f"Deepgram error in session {self._session_id}: {error}")
        asyncio.create_task(self._send_json({
            "type": "error",
            "message": "Speech recognition error",
            "code": "deepgram_error",
        }))

    async def _send_json(self, data: dict) -> None:
        try:
            await self._ws.send_json(data)
        except Exception:
            pass

    async def _send_status(self, state: str) -> None:
        await self._send_json({"type": "status", "state": state})
