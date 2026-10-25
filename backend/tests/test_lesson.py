import json
import stat

import httpx
import pytest

from app.lesson import LessonError, transcribe


def test_bilingual_evidence_preserved(tmp_path):
    audio = tmp_path / "lesson.wav"
    audio.write_bytes(b"test audio")
    output = tmp_path / "result"
    calls = []

    def respond(request):
        calls.append(request)
        assert request.url.params.get_list("language_hint") == ["en", "ja"]
        assert request.url.params["language"] == "multi"
        assert request.read() == b"test audio"
        return httpx.Response(200, json={
            "metadata": {"model_info": {"id": {"name": "general-nova-3"}}},
            "results": {"utterances": [
                {"start": 0, "end": 3, "speaker": 0,
                 "transcript": "締め切り means deadline, not tomorrow."},
                {"start": 3, "end": 5, "speaker": 1, "transcript": "来週ではありません。"},
            ]},
        })

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        receipt = transcribe(audio, output, "synthetic-test-credential", client)
        with pytest.raises(LessonError, match="already exists"):
            transcribe(audio, output, "synthetic-test-credential", client)
    assert len(calls) == 1
    assert receipt["status"] == "transcribed"
    assert receipt["recognition_quality_verified"] is False
    assert (output / "recording.wav").read_bytes() == audio.read_bytes()
    assert "来週ではありません。" in (output / "transcript.txt").read_text()
    assert "not tomorrow" in (output / "transcript.txt").read_text()
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    for file in output.iterdir():
        assert stat.S_IMODE(file.stat().st_mode) == 0o600


@pytest.mark.parametrize("status", [302, 401, 403, 429, 500])
def test_failure_retains_audio_not_response_or_secret(tmp_path, status):
    audio = tmp_path / "lesson.m4a"
    audio.write_bytes(b"original")
    output = tmp_path / "result"
    key = "synthetic-sensitive-value"
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(status, text=key)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(LessonError) as error:
            transcribe(audio, output, key, client)
    assert key not in str(error.value)
    assert len(calls) == 1
    assert (output / "recording.m4a").read_bytes() == b"original"
    assert json.loads((output / "receipt.json").read_text())["status"] == "incomplete"
    assert not (output / "provider.json").exists()
    assert key not in (output / "receipt.json").read_text()


def test_timeout_does_not_replay(tmp_path):
    audio = tmp_path / "lesson.wav"
    audio.write_bytes(b"original")
    calls = []

    def respond(request):
        calls.append(request)
        raise httpx.ReadTimeout("sensitive details must not escape")

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(LessonError, match="transport failed"):
            transcribe(audio, tmp_path / "result", "test-credential", client)
    assert len(calls) == 1


def test_missing_credential_does_not_create_output(tmp_path):
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("network"))) as client:
        with pytest.raises(LessonError, match="credential is missing"):
            transcribe(tmp_path / "lesson.wav", tmp_path / "result", "", client)
    assert not (tmp_path / "result").exists()
