import struct

from app.ear.audio_buffer import AudioBuffer


def _make_pcm(num_samples: int, value: int = 1000) -> bytes:
    return struct.pack(f"<{num_samples}h", *([value] * num_samples))


def test_append_and_clip():
    buf = AudioBuffer(duration_sec=2, sample_rate=100)
    pcm = _make_pcm(100)  # 1 second of audio
    buf.append(pcm, timestamp=0.0)

    clip = buf.clip(0.0, 1.0)
    assert clip is not None
    # WAV header is 44 bytes
    assert clip[:4] == b"RIFF"
    assert clip[8:12] == b"WAVE"


def test_clip_returns_none_for_empty():
    buf = AudioBuffer(duration_sec=2, sample_rate=100)
    assert buf.clip(0.0, 1.0) is None


def test_circular_overwrite():
    buf = AudioBuffer(duration_sec=1, sample_rate=100)
    # Write 1.5 seconds — should wrap around
    pcm1 = _make_pcm(100, value=1000)
    buf.append(pcm1, timestamp=0.0)
    pcm2 = _make_pcm(50, value=2000)
    buf.append(pcm2, timestamp=1.0)

    # Old data at 0.0 should be partially overwritten
    clip = buf.clip(1.0, 1.5)
    assert clip is not None
