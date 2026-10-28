# Kotoleaf speech gateway (Cloudflare Worker)

One Worker, named `kotoleaf`, sits between your apps and Deepgram. It always transcribes
with Nova-3 English/Japanese code-switching (`language=multi`, `language_hint=en`,
`language_hint=ja`) and adds the keyterms in `glossary.txt`. It also stores live meeting
transcripts so agents can read them during the meeting.

| Route | For | Notes |
|---|---|---|
| `POST /v1/audio/transcriptions` | Paseo dictation (OpenAI-compatible) | Model and language from the client are ignored |
| `GET /v1/listen` (WebSocket) | Anarlog live (Deepgram-compatible) | Audio passes through; every non-interim Deepgram message is stored verbatim |
| `POST /v1/listen` | Anarlog after-recording (Deepgram-compatible) | Streamed through; not stored; Cloudflare caps uploads at 100 MB |
| `GET /meetings`, `/meetings/<id\|latest>/transcript?since=&minutes=&language=`, `/meetings/<id\|latest>/raw?since=&limit=` | Agents and scripts | Compact text lines or raw Deepgram JSON |
| `POST /mcp` | Agents (MCP over HTTP, stateless JSON) | Tools: `list_meetings`, `transcript`, `raw_messages` |
| `GET /archive`, `/archive/<id>` | Older meetings | Needs the R2 binding (see Setup) |

Every route except `/health` needs `Authorization: Bearer <token>` or `Token <token>`.
Tokens are the `ACCESS_TOKENS` secret, as comma-separated `label:token` pairs. The label is
recorded as the meeting source. The local copy is `~/.config/kotoleaf/access-tokens`
(mode 600). Never paste tokens into chat or commit them.

Storage: meetings stay in a SQLite Durable Object for `HOT_DAYS` (7). Every Sunday at 03:00 JST,
older meetings are written to R2 as one gzipped JSON-lines file each (a metadata line,
then the stored Deepgram messages) and removed from the Durable Object. Without an R2
binding, nothing is deleted.

## Clients

- **Paseo (dictation and voice):**
  - `PASEO_DICTATION_STT_PROVIDER=openai`, `PASEO_VOICE_STT_PROVIDER=openai`
  - `OPENAI_STT_BASE_URL=https://kotoleaf.wandering-sky-fcce.workers.dev/v1`
  - `OPENAI_STT_API_KEY=<grisha-paseo token>`
  - `STT_MODEL=nova-3` (any value other than the `gpt-4o-*` names, so Paseo doesn't ask for logprobs)
- **Anarlog:** Settings → Transcription → Custom. Set the base URL to
  `https://kotoleaf.wandering-sky-fcce.workers.dev` and the API key to the `grisha-anarlog`
  token. Select English and Japanese as spoken languages.
- **Agents (OpenCode remote MCP):**
  `"kotoleaf": { "type": "remote", "url": "https://kotoleaf.wandering-sky-fcce.workers.dev/mcp", "headers": { "Authorization": "Bearer <grisha-agents token>" } }`

Per-word language tags are unreliable for katakana loanwords and names that exist in both
languages. The `language` filter matches any line containing that language, so read the
surrounding lines too.

## Setup and deploy

```sh
npm install
npm test            # unit tests
npm run test:e2e    # wrangler dev against a mock Deepgram; no credentials
npm run check
CLOUDFLARE_ACCOUNT_ID=dd84e8af82729f9cdf431ef565300ebe npx wrangler deploy
```

Secrets are piped in, never typed or echoed:

- `DEEPGRAM_API_KEY`: from GCP Secret Manager `kotoleaf/deepgram-api-key`.
- `ACCESS_TOKENS`: `paste -sd, ~/.config/kotoleaf/access-tokens | tr -d '\n' | npx wrangler secret put ACCESS_TOKENS`.

Still to do in the Cloudflare dashboard:

1. **Workers Paid ($5/month).** A live session measured 42 ms CPU per 16 s of audio, which
   is about 20 s for a 2-hour meeting. The free plan allows 10 ms per request. After
   upgrading, add `"limits": { "cpu_ms": 300000 }` to `wrangler.jsonc`.
2. **Enable R2.** Then run `npx wrangler r2 bucket create kotoleaf-transcripts` and add
   `"r2_buckets": [{ "binding": "ARCHIVE", "bucket_name": "kotoleaf-transcripts" }]`.

## Verified (28 Oct 2026)

- Real Deepgram, using synthetic EN/JA speech made with macOS `say`:
  - The OpenAI and batch routes return mixed EN/JA text from `general-nova-3`, with both `en` and `ja` word tags. Dictation took 1.4 s for 15 s of audio.
  - Live streaming returned its first result after 1.5–2.1 s. The meeting was stored and marked ended on close.
  - The `language=ja` filter and the MCP `transcript` tool return the mixed line.
- Not yet verified:
  - Anarlog's Custom provider end to end.
  - Paseo end to end.
  - Behaviour when a live connection drops.
  - Real meeting audio.
  - Sessions longer than about 16 s.
