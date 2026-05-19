import io
import struct
import threading


class AudioBuffer:
    """Circular buffer of raw PCM audio indexed by Deepgram timestamps."""

    def __init__(self, duration_sec: int = 120, sample_rate: int = 16000):
        self._sample_rate = sample_rate
        self._bytes_per_sample = 2  # 16-bit PCM
        capacity_samples = duration_sec * sample_rate
        self._capacity = capacity_samples * self._bytes_per_sample
        self._buffer = bytearray(self._capacity)
        self._write_pos = 0
        self._total_written = 0
        self._start_timestamp: float | None = None
        self._lock = threading.Lock()

    def append(self, audio_bytes: bytes, timestamp: float) -> None:
        with self._lock:
            if self._start_timestamp is None:
                self._start_timestamp = timestamp

            n = len(audio_bytes)
            if n >= self._capacity:
                audio_bytes = audio_bytes[-self._capacity :]
                n = self._capacity

            end_pos = self._write_pos + n
            if end_pos <= self._capacity:
                self._buffer[self._write_pos : end_pos] = audio_bytes
            else:
                first = self._capacity - self._write_pos
                self._buffer[self._write_pos :] = audio_bytes[:first]
                self._buffer[: n - first] = audio_bytes[first:]

            self._write_pos = end_pos % self._capacity
            self._total_written += n

    def clip(self, start_sec: float, end_sec: float) -> bytes | None:
        """Extract audio between timestamps. Returns WAV bytes or None."""
        with self._lock:
            if self._start_timestamp is None:
                return None

            offset_start = start_sec - self._start_timestamp
            offset_end = end_sec - self._start_timestamp
            if offset_start < 0:
                offset_start = 0

            byte_start = int(offset_start * self._sample_rate * self._bytes_per_sample)
            byte_end = int(offset_end * self._sample_rate * self._bytes_per_sample)

            buffer_start = self._total_written - self._capacity
            if buffer_start < 0:
                buffer_start = 0

            if byte_start < buffer_start:
                byte_start = buffer_start
            if byte_end > self._total_written:
                byte_end = self._total_written
            if byte_start >= byte_end:
                return None

            length = byte_end - byte_start
            read_start = byte_start % self._capacity
            if read_start + length <= self._capacity:
                pcm = bytes(self._buffer[read_start : read_start + length])
            else:
                first = self._capacity - read_start
                pcm = bytes(self._buffer[read_start:]) + bytes(
                    self._buffer[: length - first]
                )

            return self._pcm_to_wav(pcm)

    def _pcm_to_wav(self, pcm: bytes) -> bytes:
        buf = io.BytesIO()
        num_samples = len(pcm) // self._bytes_per_sample
        data_size = num_samples * self._bytes_per_sample
        # WAV header
        buf.write(b"RIFF")
        buf.write(struct.pack("<I", 36 + data_size))
        buf.write(b"WAVE")
        buf.write(b"fmt ")
        buf.write(struct.pack("<I", 16))  # chunk size
        buf.write(struct.pack("<H", 1))  # PCM format
        buf.write(struct.pack("<H", 1))  # mono
        buf.write(struct.pack("<I", self._sample_rate))
        buf.write(
            struct.pack("<I", self._sample_rate * self._bytes_per_sample)
        )  # byte rate
        buf.write(struct.pack("<H", self._bytes_per_sample))  # block align
        buf.write(struct.pack("<H", 16))  # bits per sample
        buf.write(b"data")
        buf.write(struct.pack("<I", data_size))
        buf.write(pcm)
        return buf.getvalue()
