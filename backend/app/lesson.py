"""File-based lesson transcription, independent of the live web service.

Run from backend: python -m app.lesson AUDIO --output NEW_DIRECTORY
Credentials use KOTOLEAF_DEEPGRAM_API_KEY, or an explicitly named app .env.
"""

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values

ENDPOINT = "https://api.deepgram.com/v1/listen"
PARAMS = [
    ("model", "nova-3"),
    ("language", "multi"),
    ("language_hint", "en"),
    ("language_hint", "ja"),
    ("diarize", "true"),
    ("utterances", "true"),
    ("punctuate", "true"),
]
MEDIA_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".mp4": "video/mp4", ".webm": "audio/webm", ".flac": "audio/flac",
    ".ogg": "audio/ogg",
}


class LessonError(Exception):
    """Messages are safe for operator output; never include provider bodies."""


def write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(text)


def render_transcript(result: dict) -> str:
    """Keep provider wording; speaker numbers are not inferred person names."""
    utterances = result.get("results", {}).get("utterances") or []
    if utterances:
        return "\n".join(
            f"[{float(u['start']):.2f}–{float(u['end']):.2f}] "
            f"Speaker {u.get('speaker', '?')}: {u['transcript']}"
            for u in utterances
        ) + "\n"
    channels = result["results"]["channels"]
    return "\n".join(c["alternatives"][0]["transcript"] for c in channels) + "\n"


def transcribe(audio: Path, output: Path, key: str, client: httpx.Client) -> dict:
    if not key or not key.strip():
        raise LessonError("Deepgram app credential is missing.")
    media_type = MEDIA_TYPES.get(audio.suffix.lower())
    if not media_type or not audio.is_file():
        raise LessonError("Provide a recorded WAV, MP3, M4A, MP4, WebM, FLAC or OGG file.")
    size = audio.stat().st_size
    if not 0 < size <= 512 * 1024 * 1024:
        raise LessonError("Recording must be nonempty and at most 512 MiB.")
    try:
        output.mkdir(mode=0o700)
    except FileExistsError:
        raise LessonError("Output directory already exists; it will not be overwritten.") from None

    receipt = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": ENDPOINT,
        "requested_options": PARAMS,
        "status": "incomplete",
        "recognition_quality_verified": False,
        "speaker_names_verified": False,
    }
    try:
        saved_audio = output / ("recording" + audio.suffix.lower())
        fd = os.open(saved_audio, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as dest, audio.open("rb") as source:
            shutil.copyfileobj(source, dest)
        with saved_audio.open("rb") as source:
            receipt["audio_sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
        receipt["audio_file"] = saved_audio.name
        # A single request; no automatic retry/replay that might duplicate charges.
        with saved_audio.open("rb") as source:
            response = client.post(
                ENDPOINT, params=PARAMS,
                headers={"Authorization": "Token " + key, "Content-Type": media_type},
                content=iter(lambda: source.read(65536), b""),
            )
        receipt["http_status"] = response.status_code
        if response.status_code != 200:
            raise LessonError(f"Transcription was not accepted (HTTP {response.status_code}); no retry made.")
        # Never persist a reflected credential, even in an unexpected success body.
        if key in response.text:
            raise LessonError("Unexpected provider response; body discarded.")
        try:
            result = response.json()
            text = render_transcript(result)
        except (ValueError, KeyError, TypeError, IndexError):
            raise LessonError("Provider returned an invalid transcription response.") from None
        write_private(output / "provider.json", json.dumps(result, ensure_ascii=False, indent=2))
        write_private(output / "transcript.txt", text)
        receipt["provider_metadata"] = result.get("metadata", {})
        receipt["status"] = "transcribed"
        return receipt
    except httpx.HTTPError:
        raise LessonError("Transcription transport failed; audio retained, no retry made.") from None
    finally:
        write_private(output / "receipt.json", json.dumps(receipt, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", required=True, type=Path, help="New directory under an existing parent")
    parser.add_argument("--env-file", type=Path, help="Explicit authorized Kotoleaf .env; never printed")
    args = parser.parse_args()
    # Prevent HTTP debug logging from disclosing headers in an operator environment.
    logging.disable(logging.CRITICAL)
    try:
        if args.env_file:
            if not args.env_file.is_file():
                raise LessonError("Specified app environment file is unavailable.")
            key = dotenv_values(args.env_file, interpolate=False).get("KOTOLEAF_DEEPGRAM_API_KEY")
        else:
            key = os.environ.get("KOTOLEAF_DEEPGRAM_API_KEY")
        with httpx.Client(timeout=120, follow_redirects=False, trust_env=False) as client:
            transcribe(args.audio, args.output, key or "", client)
        print("Transcript and original recording saved. Human quality review is still required.")
        return 0
    except LessonError as error:
        print(str(error), file=sys.stderr)
    except OSError:
        print("Local file operation failed; check input/output paths and permissions.", file=sys.stderr)
    except KeyboardInterrupt:
        print("Interrupted; inspect retained artifacts before deciding to retry.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
