# Canonical integration review — 12 November 2026

The preserved handoff was reviewed in place by the existing Kotoleaf owner. The
phone Live Caption/pairing request is independent; no phone action gates this work.
No helper, deployment, production secret write or paid model/audio test was launched.

## Findings and corrections

- The candidate pointed at the institutional gateway's maintainer test deployment.
  That repository's README explicitly requires a dedicated application deployment
  and prohibits credential reuse. The proposed endpoint/model defaults were removed;
  endpoint, model and token must all be explicitly configured before refinement runs.
  Actual Cloudflare secret-name inspection found only ACCESS_TOKENS,
  DEEPGRAM_API_KEY and OPENCODE_CHAT_TOKEN. GCP Kotoleaf secret-name inspection found
  only deepgram-api-key. No secret values were read or moved.
- The candidate's general R2 archive included private context/hint snapshots, despite
  the hot read API omitting those fields for general meeting readers. The shared
  archive now omits that context. A separate owner-checked archive preserves it;
  both archive writes must finish before hot rows are removed. Local integration
  tests verify another label cannot retrieve private context and the owner still can.
- Unknown channels can no longer be merged merely because speaker numbers match.
- Model redirects are not followed. The local workerd suite rejected the `error`
  redirect mode; `manual` succeeds and non-2xx responses are explicitly rejected.
- Text import wording now states that existing authorized meeting readers can read
  its transcript. Private context remains separately scoped.

## Independently checked

- Worker TypeScript check and 22 unit tests passed.
- Actual local workerd/SQLite review integration passed: raw preservation,
  source validation, model failure, single-flight, reversible decisions, learning
  handoff, chat hint lookup, restart persistence and private archive scoping.
- Existing gateway mock E2E suite passed; Wrangler deployment dry-run passed.
- New shared-Mind grounding test passed; two existing Pydantic field-name warnings
  remain. The handoff's broader backend/mobile test reports were not represented as
  newly repeated checks here.
- Deepgram's primary keyterm, language-hint and code-switching documentation was
  independently re-read. No strict EN/JP decoder or accuracy/latency guarantee follows
  from those hints. The handoff's 24.122-second synthetic text replay is not live ASR
  evidence or a realtime refinement guarantee.

## Deployment blocker

No approved dedicated refinement gateway endpoint/model/secret binding is available
to this integration. The code can preserve and review evidence, but the requested
smarter rolling model lane cannot be called working without that real binding and
an authorized consumer check. A public demo or green mock is not that check.

Needed from the operator: identify/provision the approved Kotoleaf refinement
gateway binding (endpoint, model and secret reference—not a token in chat). Existing
raw ASR, learning records and production deployment are left intact. The complete
candidate remains on its feature branch; it has not been merged or deployed as a
finished speech-quality solution.
