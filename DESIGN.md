# Kotoleaf architecture

Current implementation, checked against the repository on 12 November 2026.
For philosophy and the bilingual name, see [README](README.md). Worker operation,
API contracts, limits and recovery live in [worker/README](worker/README.md).

## Principles

- A glanceable bilingual safety net, not a replacement for listening. Participants
  read summaries in their weaker language; learning should reduce dependence on them.
- English and Japanese are equal, including mixed-language speech and names.
- Interpret context and register rather than mechanically translate each word.
- Human corrections outrank guesses. Preserve originals and correction provenance;
  hints are not guaranteed recognition or evidence that a name is correct.
- No silent collection or broader sharing. Model/provider and credential boundaries
  remain explicit. The current storage policies below are not future retention promises.

## Two separate implementations

| Component | Implemented path | Deployment / persistence |
|---|---|---|
| Speech gateway (`worker/`) | Dictation, batch and live audio → Deepgram Nova-3 EN/JA → original provider result. Confirmed spellings become next-request hints. | Deployed Cloudflare Worker; SQLite Durable Object plus R2 meeting archive. |
| Interpreter (`backend/`, `frontend/`) | SvelteKit → FastAPI WebSocket → Deepgram → Claude bilingual summaries/clarification detection → formatted display and encounters. | Docker Compose development stack with Firestore emulator; no production GCP deployment established by this document. |

These are **not** one integrated learning pipeline. The interpreter's Deepgram
client calls Deepgram directly; it does not inherit the Worker's saved spellings.
Do not remove either client as duplicate transport or assume their credentials,
storage and retention are interchangeable.

## Deployed gateway and learning loop

`worker/src/index.ts` authenticates the client and adapts the OpenAI-compatible,
Deepgram batch and live protocols. One upstream request function applies the
same label-scoped hint snapshot, fixed model/language policy and provider key.
`params.ts` owns query normalization; `store.ts` owns SQLite and archival.

The public `/learn` shell uses authenticated `/learning` requests for real data.
Its explicit demo is browser-local and makes no private API or model calls; it
does not demonstrate production persistence. The mock E2E suite separately tests
actual local workerd/SQLite across restarts and reconnects.

- Confirmations retain the recognised spelling, checked spelling, reading, note
  and timestamp. Only the checked spelling is sent upstream as a hint.
- Review judgements are appended. Undo disables future personal hints/review
  without erasing provenance; an old retried save cannot reactivate an undone term.
- Token labels define sharing scope, not individual people. The chat-only token
  retains its transcription-only access. No guessed correction is auto-confirmed.
- A new request/reconnect reloads hints; an already-open stream keeps its snapshot.
  Original provider messages/audio are not rewritten by learning operations.
- Persisted live sessions store non-interim messages. `store=false` streams and
  batch/dictation results are not stored as meetings. Saved learning is separate;
  successful dictation retains one terms-only hint receipt per label, not its text
  or audio. Receipt scope, matching semantics and failure behavior live in the runbook.
- The existing weekly archive moves old meetings to R2 before removing hot rows;
  without R2, they remain hot. Confirmation/review history is not meeting archive data.

## Interpreter development path

`SessionHandler` connects **Ear** (Deepgram, rolling transcript/audio buffers),
**Mind** (adaptive trigger, context, Claude structured summaries and clarification
detection) and **Tongue** (formatting, fugashi/MeCab furigana and linked terms).
The Svelte UI supports solo/shared portrait and landscape layouts, display/settings
controls, speaker maps and session ratings. Google sign-in and Firestore session,
summary and encounter code are present.

Speaker-name overrides in this path are distinct from gateway spelling hints:
explicit user overrides take precedence when merging model-proposed names.
The session handler saves speaker maps but does not reload them on reconnect.
It extracts clarification audio clips but currently saves encounter metadata only;
durable audio-clip upload/replay is not complete. Rolling buffers are ephemeral.

Use `docker-compose.yml` and `backend/.env.example` for the development wiring;
frontend commands are in [frontend/README](frontend/README.md). Do not start live
audio or paid model calls just to validate a change; use synthetic fixtures.

## Deferred, not implemented guarantees

FSRS scheduling/import, proficiency/growth estimates, automated institutional
glossary ingestion, meeting materials/cultural briefings, relationship-register
learning, configurable full-audio retention, Meet bots and multi-device scaling
remain future work. The gateway's `Again`/`Known` log is **not** FSRS. No WER or
learning-effectiveness improvement is claimed from the synthetic demo.

Expand only from a bounded demonstrated need: evaluate approved synthetic EN/JA
recognition first, then decide whether to bridge confirmed terms into Firestore
encounter cards. No new collection or recurring work follows from this roadmap.

## Evidence and history

- [9 November delivery receipt](worker/DELIVERY-2026-11-09.md): historical deployment
  and synthetic-test evidence, not a claim that production private data was tested.
- [12 November delivery receipt](worker/DELIVERY-2026-11-12.md): dictation hint
  receipts, bounded authentication deduplication and deployed verification.
- [Deepgram keyterm documentation](https://developers.deepgram.com/docs/keyterm):
  evidence used for the existing hint/usage-redaction policy, retrieved 9 November.
  Current limits and caveats are kept once in the worker runbook.
- The superseded long-form research/design plan (including references and cost
  estimates) is preserved in Git: `git show 0263c71:DESIGN.md`. Its future phases,
  provider comparisons and prices are historical, not current implementation facts.
