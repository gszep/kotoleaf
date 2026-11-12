# Kotoleaf speech gateway

The deployed application is this Cloudflare Worker. It uses Deepgram Nova-3 with
`language=multi` and repeated `language_hint=en` / `language_hint=ja`. Hints prefer
English/Japanese; they **do not restrict** recognition to those languages.
All audio routes share `src/params.ts` and `requestDeepgram` in `src/index.ts`.
The root FastAPI/Svelte interpreter is a separate prototype; see [architecture](../DESIGN.md).
Contextual text refinement remains research-only, not part of this release.

## Interfaces and authorization

Origin: `https://kotoleaf.wandering-sky-fcce.workers.dev`.

| Route | Contract |
|---|---|
| `GET /health` | Public liveness and deployed version, not upstream authentication |
| `POST /v1/audio/transcriptions` | OpenAI-compatible multipart `file`; client model/language ignored; returns text/language, no audio/transcript storage |
| `POST /v1/listen` | Deepgram-compatible batch; body unchanged, query normalized; response passed through, not stored |
| `GET /v1/listen` (WebSocket) | Audio unchanged; raw non-interim messages stored in order unless `store=false`; transient streams create no meeting |
| `GET /meetings`, `/meetings/<id\|latest>/transcript`, `/meetings/<id\|latest>/raw` | Meeting listing, compact lines or raw provider JSON; query options below |
| `POST /mcp` | Read tools: `list_meetings`, `transcript`, `raw_messages` |
| `GET /archive`, `/archive/<id>`; `POST /archive/run` | List/download gzipped JSON-lines archives; request existing archival policy |
| `GET /learn`, `/learn.js` | Public mobile shell/assets; `/learn?demo=1` is synthetic, browser-local and makes no ASR calls |
| `GET/POST /learning`, `PATCH /learning/<id>`, `POST /learning/<id>/reviews` | Label-scoped confirmed vocabulary, persistent undo/reviews and latest hint receipt |

Protected routes require `Authorization: Bearer <token>` or `Token <token>`.
`ACCESS_TOKENS` holds deployment-owned `label:token` pairs. A label scopes learning;
sharing it shares that learning space, and renaming it creates another space.
Meeting/raw/archive readers retain their existing broader read boundary.
The separate `OPENCODE_CHAT_TOKEN` permits only `POST /v1/audio/transcriptions`;
it cannot read/write learning, meetings, archives or MCP, and shares no other
label's vocabulary. Never put credentials in browser code, URLs, logs or Git.
Inspect secret names first; use the authorized provisioning path rather than
extracting another app's token. `DEEPGRAM_API_KEY` is server-side.
Its existing source is GCP Secret Manager project `kotoleaf`, secret `deepgram-api-key`;
that reference is not a claim of automatic runtime secret injection.

**Clients:** use the origin plus `/v1` as the OpenAI-compatible base URL and
`nova-3` as model (avoid `gpt-4o-*`, which makes Paseo request logprobs). Anarlog's
custom provider uses the origin and its privately supplied gateway credential.
Agents use `/mcp` with the existing private Authorization-header binding. Gateway
tokens are not Deepgram keys. Client/account compatibility needs its own live check.
For Paseo's environment-based configuration, both `PASEO_DICTATION_STT_PROVIDER`
and `PASEO_VOICE_STT_PROVIDER` are `openai` (protocol, not engine).
`OPENAI_STT_BASE_URL`, privately supplied `OPENAI_STT_API_KEY` and `STT_MODEL`
carry the base URL, gateway token and `nova-3` model respectively.

## Storage and reading

Raw provider messages are immutable; speaker/language listing labels are derived.
`transcript` accepts `since`, `minutes`, `language`; `raw` accepts `since`, `limit`
(default 50, maximum 200). A returned `next_since` supports incremental reads.
Language filtering includes mixed lines; katakana loanwords and names make per-word
tags unreliable, so inspect surrounding text. Dominant speaker numbers are not
verified identities. Uploads remain subject to Cloudflare's upload limit.

`HOT_DAYS` is seven. The existing Sunday 03:00 JST alarm archives older meetings to
R2 as metadata plus original messages, then removes their hot rows. Without
`ARCHIVE`, nothing is deleted. Confirmed learning, its review history and the latest
hint receipt per label remain separate from meeting archival. No new audio retention,
deletion UI or full-audio replay is provided.

## Confirmed learning and undo

Open `/learn` with the label used by the dictation/meeting client. Explicitly confirm
a spelling; optional original text, reading and study note remain private learning
data. Active spellings are prepended to `glossary.txt` on the next batch/dictation
request or live-stream connection, including `store=false`. Existing streams keep
their starting snapshot. No text replacement, inferred names or accuracy guarantee.

Writes use UUIDv4 request IDs. Retry the **same body and ID** after an ambiguous
response; different content with that ID returns 409. Replaying an undone
confirmation cannot reactivate it. `POST /learning`, for example:

```json
{"id":"b59ab753-893c-428b-8075-88a35bc8b010","confirmed":true,"original":"光洋ラボ","term":"紅葉ラボ","reading":"こうようラボ","meaning":"Koyo Lab — fictional"}
```

Undo: `PATCH /learning/<id>` with `{"active":false}`. Review:
`POST /learning/<id>/reviews` with a new UUID and `rating: "again"` or `"known"`.
These are recorded judgements, not FSRS/proficiency estimates. Undo preserves the
confirmation and review history; no API accepts another owner label in its body.

Limits: 16 active personal terms, 48 UTF-8 bytes per spelling, 240 bytes across
personal terms. Glossary/client terms also share Deepgram's 500-token limit;
this application does not tokenize that budget. Only confirmed spellings—not
originals, readings or meanings—go to Deepgram. `redact_usage=true` hides names
in provider usage records; it does not change provider audio retention.

## Dictation hint receipts

After successful OpenAI-compatible dictation, `/learning` and **Reload saved
learning** show `last_hint_receipt`: one request UUID, timestamps, personal spellings
actually included, and literal NFC/case-sensitive substring matches in the result.
No transcript/audio copy or receipt history is stored. This is request evidence,
not word-boundary/fuzzy matching, causal attribution or an accuracy score.

Undo does not rewrite receipts. The next successful request replaces the receipt,
even with an empty hint list; failed upstream requests leave it intact. Check its
time. Batch/live, glossary/client hints and the chat-only token are outside this
feature. `X-Kotoleaf-Hint-Receipt` is `saved`, `unavailable` on storage failure, or
`not-recorded` for chat/no valid transcript. Receipt failure never discards otherwise
successful dictation. Responses are `no-store`; in-flight hint snapshots are stable.

## Development, deployment and evidence

From `worker/`, using Node 24 and the committed lockfile:

```sh
npm ci
npm run check
npm test
npm run test:e2e  # real local workerd/SQLite with mock Deepgram; no paid calls
npm run build   # deployment dry-run
```

For authorized deployment, confirm the existing account/Worker bindings, then run
`npm run deploy`. Check the served `/health` version and `/learn` assets afterward;
neither proves model authentication or recognition quality. Do not replace secrets,
personal data, account settings or retained databases during a routine update.

Optional mobile tests use `KOTOLEAF_BROWSER_PYTHON=/path/to/python-with-playwright`
with `npm run test:e2e` and the shared `agents-md/tools/browser_session.py` helper
(`BROWSER_TOOLS` overrides its directory). `node test/make-preview.mjs` creates a
synthetic `.preview/` for an existing Tailscale path; it is not production delivery.

Mock checks cover all three audio routes, unchanged raw bytes, authorization,
SQLite restart, review/undo, failure/reconnect handling and hint receipts. They do
not establish ASR accuracy, app end-to-end use or long-session performance.
Historical receipts: [9 November](DELIVERY-2026-11-09.md),
[12 November](DELIVERY-2026-11-12.md). Preserve them as dated evidence, not live status.
Deepgram's [keyterm guide](https://developers.deepgram.com/docs/keyterm) supports
focused multilingual hints and usage redaction; optional mid-stream updates are
deliberately not used here. The legacy FastAPI/Firestore learning path is separate.
