# Kotoleaf speech gateway (Cloudflare Worker)

## Contextual review (12 November increment)

**Candidate, not deployed:** the canonical-owner review found no approved dedicated
refinement binding. The maintainer's test URL was removed from deployment defaults.
The model lane requires explicit `REFINEMENT_URL`, `REFINEMENT_MODEL` and
`REFINEMENT_TOKEN`; the existing production ASR/learning service remains separate.
See `INTEGRATION-2026-11-12.md` for the current gate and verified checks.

The fast audio path remains Nova-3. It never waits for the text model and never
silently replaces a person's name, punctuation, raw text, audio bytes or timestamps.
The new review lane is a **candidate meeting-notes workflow**, not a validated
replacement for listening to the original recording or for Gemini meeting capture.
See [current research and evaluation gaps](RESEARCH-2026-11-12.md).

Open `/review` using your existing recording/dictation token label. Stored live
meetings appear there; dictation, batch and `store=false` streams retain their
existing non-persistence behavior and do **not** appear automatically. Paste an
authorized transcript to create a clearly marked text-only import with unknown
audio timestamps. Text imports are not audio-quality tests. The existing mobile
recording clients are not patched and do not receive replacement streamed text.

For the server-configured `AUTO_REFINE_LABEL` only, new stored finals trigger a
request-owned background refinement after approximately 30 seconds of new speech
or 1,500 characters, with a 30-second automatic cooldown. End-of-stream requests
flush the final tail. This is not a new cron/background service. Every model call
is bounded to 32 chunks / 12,000 characters, plus at most two earlier context chunks,
and 45 seconds. Sparse speech waits for more evidence or explicit refinement.
Manual **Refine next window** and the optional page-open follow loop drain a large
backlog in bounded windows. There is no guarantee of a 30-second displayed latency:
model runtime is additional. Windows do not retroactively merge prior revisions.

`REFINEMENT_URL`, `REFINEMENT_MODEL` and the private `REFINEMENT_TOKEN` must identify
an operator-approved application gateway. No default endpoint or model is selected,
and no provider OAuth is extracted or shipped to browsers. The proposed institutional
integration is experimental; its own documentation requires a dedicated deployment
and prohibits reusing maintainer credentials. No such Kotoleaf binding is installed.
Missing configuration, timeout, refusal, truncation, malformed output or invalid
source citations leave raw transcripts unchanged and show a failure, not fake notes.
There is no fallback provider or automatic paid API retry. Single-flight is per
meeting; failed attempts cool down for 30 seconds before retry. Interrupted jobs
are recoverable on a subsequent request after 90 seconds. Stopping the browser
follow loop does not stop your live client's recording or automatic server lane.

The model reuses `backend/app/mind/{institution,grounding}.txt`, active explicitly
confirmed vocabulary and a bounded private context entered in this scope. No
Workspace/messages are harvested. Private context is sent to the configured model,
not to Deepgram; Deepgram receives confirmed spellings only. Context edits affect
future windows, not old immutable snapshots or an in-flight request.

Original sources, cleaned proposals, bilingual discussion/decision/action/question
notes and study candidates are separate. Every output covers known source IDs;
notes/terms must quote exact raw excerpts. Mixed/unknown speakers cannot be merged;
raw speaker numbers are never treated as verified identities. Structural citation
checks do **not** prove entailment, correct translation or correct punctuation.
All output starts as a draft, including punctuation-only changes. Accept/reject/undo
changes the review decision, not the source or model result; changes are logged.
The receipt download retains sources, timestamps, model, context snapshot and review
history. Existing MCP/meeting readers can read derived results with explicit review
status, but not the owner's private context/hint inventory.

Confirm a candidate's spelling, reading and meaning to hand it to the **existing**
learning store. Its evidence and revision pointer are retained with the card, and
the next transcription uses the confirmed spelling as a hint. Again/Known/undo
continue to work; there is no new parallel flashcard store or claim of FSRS. The
existing 16-term/240-byte hint capacity also applies to these cards. Raw notes and
rejected drafts are never auto-confirmed as personal vocabulary. Accepted windows
are user-reviewed, not independently audio-validated facts.

Weekly archive includes derived snapshots and review decisions alongside original
provider messages, excluding private context/hint snapshots. Those snapshots are
preserved separately and accessible only under the original owner label through
`GET /review-data/<id>/archive-context`. Live meetings and running refinements are not archived. Learned
card evidence persists independently; the complete older review UI is not yet
archive-aware, so older full meetings require the existing authenticated archive
download. Undo is not deletion; no new deletion or full-audio replay UI is supplied.

One Worker, named `kotoleaf`, sits between your apps and Deepgram. It always transcribes
with Nova-3 English/Japanese code-switching (`language=multi`, `language_hint=en`,
`language_hint=ja`) and adds the keyterms in `glossary.txt`. It also stores live meeting
transcripts so agents can read them during the meeting.

| Route | For | Notes |
|---|---|---|
| `POST /v1/audio/transcriptions` | Paseo dictation (OpenAI-compatible) | Model and language from the client are ignored |
| `GET /v1/listen` (WebSocket) | Anarlog live, FlowAtlas relay (Deepgram-compatible) | Audio passes through; every non-interim Deepgram message is stored verbatim. Add `store=false` for a transient stream: results are relayed, nothing is stored, and no meeting is created |
| `POST /v1/listen` | Anarlog after-recording (Deepgram-compatible) | Streamed through; not stored; Cloudflare caps uploads at 100 MB |
| `GET /meetings`, `/meetings/<id\|latest>/transcript?since=&minutes=&language=`, `/meetings/<id\|latest>/raw?since=&limit=` | Agents and scripts | Compact text lines or raw Deepgram JSON |
| `POST /mcp` | Agents (MCP over HTTP, stateless JSON) | Tools: `list_meetings`, `transcript`, `raw_messages` |
| `GET /archive`, `/archive/<id>`, `POST /archive/run` | Older meetings | gzipped JSON lines in R2; `run` archives now instead of waiting for Sunday |
| `GET /learn`, `/learn?demo=1` | Phone-friendly confirmed learning | Public shell; real data requires an existing access token. Demo is synthetic, browser-local, no ASR calls |
| `GET /review`, `/review?demo=1` | Phone-friendly meeting review | Original sources, cleaned drafts, bilingual notes, accept/reject/undo and source-linked Japanese learning. Public shell only; demo is synthetic |
| `GET /review-data`, `/review-data/<id>` | Private review space | Owner-label scoped; includes context and immutable source snapshots. Chat credential is denied |
| `GET /review-data/<id>/archive-context` | Owner's archived private context | Owner-label checked against archive metadata; not exposed through general archive readers |
| `POST /review-data/context`, `/review-data/import`, `/review-data/<id>/refine` | Context / text-only import / bounded refinement | Explicit authenticated writes; import UUID is idempotent; originals and unknown timestamps retained |
| `PATCH /review-data/<id>/revisions/<uuid>`, `POST /review-data/<id>/learn` | Human review / learning | Reversible review decisions; candidate learning requires explicit confirmation and uses existing `/learning` store |
| `GET /meetings/<id>/review`, MCP `meeting_review` | Existing meeting readers | Source-linked draft/accepted outputs; private context and personal hint snapshots omitted |
| `GET/POST /learning`, `PATCH /learning/<id>`, `POST /learning/<id>/reviews` | Confirmed terms, review log and last dictation hint receipt | Scoped to the authenticated token **label**; chat-only token has no access |

Every route except `/health`, `/learn`, `/review` and their JS assets needs `Authorization: Bearer <token>` or `Token <token>`.
Tokens are the `ACCESS_TOKENS` secret, as comma-separated `label:token` pairs. The label is
recorded as the meeting source. The local copy is `~/.config/kotoleaf/access-tokens`
(mode 600). Never paste tokens into chat or commit them.

`OPENCODE_CHAT_TOKEN` is a separate optional secret for the chat bridge. It accepts
only `POST /v1/audio/transcriptions`: it cannot access meetings, archives, MCP or
streaming routes. Provision a newly generated value directly into the Worker
secret and the bridge's private token file; do not extract another app's token.
`CHAT_LEARNING_LABEL` now explicitly selects an existing learning label for its
**hint lookup only**. Removing that variable restores an isolated chat vocabulary.
This never grants the chat credential read/write access to learning, context or notes.

Storage: meetings stay in a SQLite Durable Object for `HOT_DAYS` (7). Every Sunday at 03:00 JST,
older meetings are written to R2 as one gzipped JSON-lines file each (a metadata line,
then the stored Deepgram messages) and removed from the Durable Object. Without an R2
binding, nothing is deleted. Learning history and the single latest dictation
hint receipt per label are separate from meeting archival.

## Clients

- **Paseo (dictation and voice):**
  - `PASEO_DICTATION_STT_PROVIDER=openai`, `PASEO_VOICE_STT_PROVIDER=openai`
  - `OPENAI_STT_BASE_URL=https://kotoleaf.wandering-sky-fcce.workers.dev/v1`
  - `OPENAI_STT_API_KEY=<grisha-dictation token>`
  - `STT_MODEL=nova-3` (any value other than the `gpt-4o-*` names, so Paseo doesn't ask for logprobs)
- **Anarlog:** Settings → Transcription → Custom. Set the base URL to
  `https://kotoleaf.wandering-sky-fcce.workers.dev` and the API key to the `grisha-dictation`
  token. Select English and Japanese as spoken languages.
- **Agents:** stateless MCP endpoint `https://kotoleaf.wandering-sky-fcce.workers.dev/mcp`.
  Supply the existing agent token through the client's private Authorization-header
  configuration, not a token committed in a configuration example.

Per-word language tags are unreliable for katakana loanwords and names that exist in both
languages. The `language` filter matches any line containing that language, so read the
surrounding lines too.

## Setup and deploy

```sh
npm ci
npm test            # unit tests
npm run test:e2e    # wrangler dev against a mock Deepgram; no credentials
npm run check
npm run test:review  # mock model + real local SQLite; no production API calls
# Optional actual mobile UI test, with an existing Playwright Python environment:
KOTOLEAF_BROWSER_PYTHON=/path/to/python-with-playwright npm run test:e2e
# browser-learning.py uses the shared agents-md/tools/browser_session.py helper;
# override its directory with BROWSER_TOOLS if installed elsewhere.
CLOUDFLARE_ACCOUNT_ID=dd84e8af82729f9cdf431ef565300ebe npx wrangler deploy
```

Secrets are piped in, never typed or echoed:

- `DEEPGRAM_API_KEY`: from GCP Secret Manager `kotoleaf/deepgram-api-key`.
- `ACCESS_TOKENS`: `paste -sd, ~/.config/kotoleaf/access-tokens | tr -d '\n' | npx wrangler secret put ACCESS_TOKENS`.

Plan and storage (done 28 Oct): Workers Paid with `limits.cpu_ms = 300000`, because a live session
measured 42 ms CPU per 16 s of audio, or about 20 s for 2 hours. The R2 bucket `kotoleaf-transcripts`
is bound as `ARCHIVE`.

## Verification boundary

The mock E2E suite covers all three client protocols, original bytes, credential
replacement/isolation, SQLite restart retention, review/undo, failures/reconnects
and dictation receipt snapshots. Optional mobile checks cover rendering and
lost-response retries. No paid calls, real meeting data or microphones are used;
this does not prove accuracy gains, long-session reliability or app end-to-end use.
Deployment evidence: [12 November](DELIVERY-2026-11-12.md); historical learning
delivery: [9 November](DELIVERY-2026-11-09.md). Older provider timings remain in
`git show 0263c71:worker/README.md`, not current guarantees.

## Confirmed learning (9 Nov 2026)

Open `/learn` with the same access-token label used by your dictation/meeting app.
Confirm a spelling, optionally retaining the recognised spelling, reading and a
short study note. The next OpenAI-compatible, batch or live request using that
label loads active spellings from SQLite and adds them as Deepgram `keyterm`
hints ahead of the existing glossary. This includes `store=false` streams: the
stream stays transient, but explicitly saved learning is retained separately.
Open streams use their starting snapshot; reconnect to pick up new confirmations
or undo. We do **not** replace text, alter raw messages, store new audio, infer
names, or claim that a hint guarantees correct recognition.

`Again` / `Known` append a timestamped review judgement. This is not FSRS or an
automatic proficiency estimate. Undo removes a term from future hints and active
review, retaining the original confirmation, its timestamp and review history.
These records are independent of meeting archival. There is no deletion UI yet.
Names are scoped by token **label**, not by an individual user: sharing a label
shares the learning space. Renaming a token label starts a different space.
The separate chat credential remains transcription-only; the explicit server-side
`CHAT_LEARNING_LABEL` mapping now shares the chosen label's confirmed hints with it.
The FastAPI/Firestore learning storage pipeline is unchanged. Both interpreter
paths reuse the Mind institutional context and source-grounding instructions.

API writes require UUIDv4 request IDs. Retry unchanged bodies with the same ID
after a dropped response. A reused ID with different content returns 409; a late
retry of an undone confirmation cannot reactivate it. `POST /learning` body:

```json
{"id":"b59ab753-893c-428b-8075-88a35bc8b010","confirmed":true,"original":"光洋ラボ","term":"紅葉ラボ","reading":"こうようラボ","meaning":"Koyo Lab — fictional"}
```

Only set `confirmed` after the user has checked the spelling. Undo with
`PATCH /learning/<id>` and `{"active":false}`. Review with
`POST /learning/<id>/reviews` and `{"id":"<new UUIDv4>","rating":"again"}`
(or `known`). No API accepts another owner label from the request body.

Limits: 16 active personal hints, 48 UTF-8 bytes per spelling, 240 bytes across
personal hints; this deliberately leaves room for the static glossary. Existing
client-supplied hints still share Deepgram's overall 500-token budget. If clients
send excessive hints, Deepgram may reject them; this slice does not introduce a
provider tokenizer. Only confirmed spellings go upstream, not recognised forms,
readings or meanings. `redact_usage=true` is enforced so names in query hints are
redacted from Deepgram usage records. This does not change provider audio retention.

The public `/learn?demo=1` uses browser-local synthetic examples. Reload demonstrates
local retention, **not** production SQLite; the mock E2E suite checks the latter.

For a static Tailscale preview, run `node test/make-preview.mjs` and serve the
generated `.preview/` directory under its own path in the existing Serve config.
This copy always uses synthetic demo mode and needs no server/background job.

## Dictation hint receipts (12 Nov 2026)

After a successful `/v1/audio/transcriptions` request, open `/learn` with the same
token label and choose **Reload saved learning**. The receipt shows the personal
confirmed hints actually included in that request's query and which occur in its
returned text. `GET /learning` exposes it as `last_hint_receipt` (or `null`).

Only one receipt is retained per label: request UUID, start/completion timestamps,
spellings and `appeared` flags. No transcript or audio is copied. Matching uses
case-sensitive NFC-normalized substrings, not word boundaries, fuzzy matching or
causal attribution. Capitalization/spacing differences can yield “not found”;
substring matches can occur inside longer words. Neither result measures accuracy.
Undo does not rewrite past receipts; the next successful dictation replaces them,
including an empty list if no personal hints remain. Requests already in flight
keep their original snapshot. There is no backfill or receipt history.

Batch/live routes, glossary/client hints and the chat-only credential are outside
this receipt feature. Failed upstream requests leave the last successful receipt.
Receipt storage failure must not lose successful dictation: the unchanged response
body is returned with `X-Kotoleaf-Hint-Receipt: unavailable`; otherwise this header
is `saved`, or `not-recorded` for chat/no valid transcript. Check the receipt time
before attributing it to a new request. Successful dictation responses are `no-store`.
The demo's **Try synthetic dictation receipt** compares against fixed invented text;
it never runs recognition.

Design evidence: Deepgram's [keyterm guide](https://developers.deepgram.com/docs/keyterm)
(retrieved 12 Nov 2026) supports Nova-3 multilingual hints, recommends small focused
lists and `redact_usage=true` for names, and documents both the 500-token limit
and optional mid-stream `Configure`. We deliberately use next-request snapshots
rather than mid-stream mutation in this bounded increment.
