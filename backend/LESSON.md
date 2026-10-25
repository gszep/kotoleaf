# Recorded lesson transcription

This small fallback processes a saved recording without the live web app,
Firestore, Google login, an LLM summary, or a Paseo daemon upgrade. It does not
record your microphone or join a meeting. Keep your original recording and
check that both speakers are audible before relying on it for a lesson.

From the backend directory, using the project's Python environment:

```sh
.venv/bin/python -m app.lesson /path/to/lesson.m4a \
  --output /path/to/new-lesson-artifacts \
  --env-file /path/to/authorized/kotoleaf/backend/.env
```

The output parent must already exist. The output directory must be new; previous
lessons are never overwritten. Without `--env-file`, the command uses the existing
`KOTOLEAF_DEEPGRAM_API_KEY` environment binding. Do not put a key in a command or
commit an environment file. An explicit environment file is read without shell
execution or variable interpolation, and only the Kotoleaf Deepgram key is used.

The command sends one prerecorded request to Deepgram `/v1/listen`, requesting
Nova-3, multilingual mode, English/Japanese language hints, diarization and
utterance timestamps. This consumes Deepgram transcription usage. Hints bias
language detection rather than exclude other languages. There is no automatic
retry; a timeout can still mean the provider processed the audio. The HTTP
timeout is 120 seconds per operation, not an end-to-end deadline.

Artifacts are private (directory 0700, files 0600):

- `recording.*`: retained copy of the input, unchanged.
- `provider.json`: successful provider response, including word-level evidence.
- `transcript.txt`: timestamped utterances without translation or correction.
- `receipt.json`: input hash, requested options, returned model metadata and status.

Failures retain the recording and an incomplete receipt when possible. Provider
error bodies and credentials are not written to console or artifacts. Speaker
numbers are tentative clusters, not verified names. A successful request is not
a recognition-quality pass: check Japanese script, switches, negation, names,
numbers and the last words against the recording. Preserve corrections separately
from the provider transcript. Vocabulary review, spaced repetition, kanji writing,
meeting summaries and live capture remain separate work.

Language hint reference: Deepgram's official `nova-3-language-prompting` guide.
