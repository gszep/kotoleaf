# Kotoleaf Design Document

## Context

ChibaTech is a bilingual English/Japanese organisation. For large events we use [Flitto](https://flitto.jp) for live simultaneous translation. Flitto's strengths -- context-buffered translation, custom glossaries, and natural-sounding output -- are exactly what we want. But their event-oriented pricing makes them impractical for day-to-day meetings, and sending institutional knowledge to a third party raises privacy concerns.

Kotoleaf is an in-house tool that brings the best of Flitto and the broader simultaneous translation landscape into a system we own, while pursuing a fundamentally different goal: not just translating, but teaching. The leaves fall as the roots grow.

## Design Principles

1. **The roots, not the leaves, are the goal.** Every feature should strengthen the root network -- shared vocabulary, cultural understanding, mutual trust -- between participants. Translation is the means, not the end.

2. **Privacy where it matters.** Meeting audio is sent to Deepgram for ASR; transcript text is sent to DeepL/Google (translation) and Anthropic (contextual intelligence) for processing -- all are SOC 2 Type II and GDPR compliant. Vocabulary data, institutional glossary, and growth state remain on ChibaTech's GCP infrastructure. The default is to keep only vocabulary growth, discarding transcripts.

3. **Nemawashi-first design.** The system is designed around 1-to-1 bilingual conversation (nemawashi) as the primary use case. If it works beautifully for two people building consensus, everything else scales from there.

4. **Symmetric.** English and Japanese are treated as equal. The system serves both directions with equal care.

## Modes of Operation

| Mode | Participants | Interleaving | Audio Source |
|------|-------------|--------------|-------------|
| **Nemawashi** (1-to-1) | 2 | Per-person growth level | Device microphones |
| **Small meeting** (in-person) | 3-5 | Per-person growth level | Device or room microphones, server diarizes |
| **Meet call** (6+) | 6+ | Max Interleaf (single stream) | Google Meet bot captures all audio |

In all modes, vocabulary from the meeting feeds into each authenticated user's personal database. Even in Max Interleaf mode (where everyone sees full translation regardless of their level), the system tracks which terms are new for each user.

**Max Interleaf** can also be invoked manually in any mode when full translation is desired -- for example, when an English speaker is pitching to Japanese executives and wants maximum support regardless of their vocabulary level.

## Architecture

Three processing layers named for the metaphor: Ear (perception), Mind (understanding), Tongue (expression).

```
+---[ Participant Browser ]-------------------------------------------+
|                                                                     |
|  +--[ Kotoleaf Web App ]----------------------------------------+  |
|  |                                                              |  |
|  |  Meeting view with subtitle bar                              |  |
|  |                                                              |  |
|  |  +--[ Flashcard Review Mode ]--+                             |  |
|  |  | FSRS spaced repetition      |                             |  |
|  |  | Cards with meeting context   |                             |  |
|  |  +-----------------------------+                             |  |
|  +--------------------------------------------------------------+  |
+---------------------------------------------------------------------+
         |                    |
    [WebSocket]          [Google SSO]
         |                    |
+---[ GCP Cloud Run ]------------------------------------------------+
|                                                                     |
|  +--[ Kotoleaf Server (no GPU) ]----------------------------------+ |
|  |                                                                | |
|  |  Ear ────────> Mind ────────> Tongue                           | |
|  |  - Deepgram     - Comprehension    - DeepL / Google NMT        | |
|  |    Nova-3 API     model              (real-time translation)   | |
|  |    (ASR +       - Growth level     - Claude Haiku 4.5          | |
|  |    diarization    calculator         (contextual correction    | |
|  |    + LID)       - Glossary lookup    + interleaving decisions) | |
|  |                 - Misunderstanding  - Interleaver               | |
|  |                   detection        - Per-user filter            | |
|  +---+-------------------+-------------------+--------------------+ |
|      |                   |                   |                      |
|  +---+-------+  +--------+-----------+  +----+-------------+       |
|  | User      |  | Institutional      |  | Meeting          |       |
|  | Vocab     |  | Glossary           |  | Materials        |       |
|  | SRS (FSRS)|  | (ChibaTech terms)  |  | (per-session)    |       |
|  | Firestore |  | from Workspace,    |  | Slides, Docs,    |       |
|  +-----------+  | GitHub, Slack      |  | briefing notes   |       |
|                 | Firestore          |  | Firestore        |       |
|                 +--------------------+  +------------------+       |
|                                                                     |
|  +--[ Google Meet Bot ]--+    +--[ API Providers ]---------------+  |
|  | Headless browser /     |    | Deepgram Nova-3 (streaming ASR) |  |
|  | MeetingBaaS / Attendee |    | DeepL / Google (real-time NMT)  |  |
|  | Captures audio         |    | Anthropic Claude Haiku 4.5 /    |  |
|  | Routes to Ear          |    |   Sonnet 4.6 (intelligence)     |  |
|  +-----------------------+    +---------------------------------+  |
+---------------------------------------------------------------------+
```

### Ear (Perception)

Captures live audio and converts it to text with speaker attribution and language tagging.

- **Speech Recognition** (Deepgram Nova-3, `language=multi`) -- multilingual streaming ASR via WebSocket API. True EN-JA code-switching with per-word language tags. Sub-300ms latency. The Feb 2026 multilingual update improved code-switching WER by ~21%.
- **Speaker Diarization** -- Deepgram's built-in streaming diarization (add-on at $0.0020/min). No separate model needed. No speaker count limitations like self-hosted alternatives.
- **Language Detection** -- built into Deepgram's multilingual mode. Each word is tagged with its detected language. No separate language ID model needed.
- **Voice Activity Detection** -- handled by Deepgram server-side. No client-side VAD needed.

For Google Meet calls, a Kotoleaf bot joins the meeting via a headless browser (Playwright) and captures participant audio server-side. The Google Meet Media API offers an official path for real-time audio capture but remains in Developer Preview (as of early 2026) with restrictions that make it impractical for production -- all participants must be enrolled in the Developer Preview Program, consent can be revoked mid-call, and the reference client implementations (C++/TypeScript on GitHub) are samples rather than a polished SDK. Fireflies.ai has demonstrated production use of the Media API despite Developer Preview status, suggesting it is maturing.

The headless browser approach is the standard production pattern today (used by Recall.ai and similar meeting bot services), though it carries **Terms of Service risk** -- browser automation may violate Google Meet's ToS, and Google can break bot functionality at any time by changing DOM structure or adding CAPTCHAs. Several open-source meeting bot frameworks have emerged in 2025-2026 that reduce the build-from-scratch burden: **MeetingBot** (github.com/meetingbot/meetingbot), **Attendee** (attendee.dev), **CueMeet** (cuemeet.ai), and **MeetingBaaS** (meetingbaas.com, $0.066/hr hosted). Commercial APIs like **Recall.ai** abstract away all bot infrastructure for Google Meet, Zoom, and Teams.

Migration path: Media API when it reaches GA; in the interim, evaluate MeetingBaaS or Attendee as alternatives to building a custom Playwright bot. For in-person meetings, audio comes from each participant's device microphone.

Cost: ~$0.0092/min ($0.55/hr) for multilingual streaming + $0.0020/min diarization = ~$0.67/hr total.

### Mind (Understanding)

The intelligence layer. Maintains per-participant state and decides what to surface.

- **Comprehension Model** -- tracks each participant's known vocabulary and estimates whether they understood what was just said
- **Growth Level Calculator** -- determines each participant's current level (Seedling / Canopy / Deep Root / Evergreen) based on their FSRS vocabulary state
- **Glossary Lookup** -- checks terms against the institutional glossary (ChibaTech-specific abbreviations, project names, domain terminology) and any per-meeting session glossary from uploaded materials
- **Misunderstanding Detection** -- identifies moments where meaning is likely to be lost: false cognates, ambiguous grammar, cultural context gaps, or concepts that don't translate directly (e.g. detecting that "kentou shimasu" often means "no" rather than the literal "I'll consider it")

The Mind's output for each term is a decision: **surface** (include in this participant's interleaving) or **trust** (the roots are strong enough, let it pass).

### Tongue (Expression)

Produces personalised output for each participant.

- **Translation** (hybrid: dedicated NMT + LLM) -- a two-tier approach tuned for the competing demands of speed and nuance:
  - **Tier 1 (real-time subtitles)**: DeepL API or Google Cloud Translation v3 for the primary subtitle stream. Dedicated NMT delivers ~50-100ms latency and strong EN-JA quality at ~$20-25/million characters. This tier covers the majority of straightforward translation.
  - **Tier 2 (contextual enrichment)**: Claude Haiku 4.5 for glossary-aware correction, cultural annotations, misunderstanding explanations, and interleaving decisions. Each segment is sent with the system prompt containing: ChibaTech glossary, per-meeting session glossary, participant relationship context, recent conversation history, and register guidance. Claude's contextual awareness produces more natural translations for nuanced content than dedicated NMT.
  
  The hybrid approach is motivated by latency constraints: independent benchmarks (llm-benchmarks.com, Feb 2026) show Claude Haiku 4.5 averaging ~640ms time-to-first-token with total call latency of 1.5-2 seconds -- acceptable for enrichment overlays but too slow for primary subtitle delivery. Dedicated NMT APIs are 10-20x faster. Anthropic prompt caching (90% cost reduction on repeated system prompts) keeps the Claude tier cost-effective.
- **Interleaver** -- formats the subtitle output, calibrated to each participant's growth level:
  - **Seedling**: full translation with vocabulary annotations, readings, cultural notes
  - **Canopy**: key terms and idiomatic expressions surfaced, core meaning flows naturally
  - **Deep Root**: only rare vocabulary or detected misunderstandings break through
  - **Evergreen**: silent unless invoked
- **Per-User Filter** -- the lightweight step that makes personalisation cheap. The heavy work (ASR, translation, correction) is shared across all participants. The filter just decides which terms to show each person based on their vocabulary database.

## Growth System

The growth system is how Kotoleaf becomes its own obsolescence. Leaves fall as roots grow.

### Vocabulary Tracking

Every term a participant encounters during meetings is captured with context:

```
Term:      稟議 (りんぎ)
Meaning:   Ringi -- formal approval process where a proposal document
           circulates through management for consensus
Context:   "この案件は稟議を通す必要があります"
           (This matter needs to go through the ringi process)
Meeting:   2026-02-21, Meeting with Tanaka-san
Tags:      [business, ChibaTech, approval-process]
```

### Spaced Repetition (FSRS)

Encountered terms become flashcards in a personal database, reviewed using the FSRS algorithm (the modern successor to SM-2, used natively by Anki since v23.10, default since ~2026). FSRS-6 (21 parameters, latest version) is backed by a peer-reviewed ACM KDD paper (Ye, Su & Cao, 2022) and shows ~99% superiority over SM-2 with optimised parameters across the open-spaced-repetition benchmark (dataset of 10,000-20,000 Anki users; exact figures vary by version). Implementation uses `py-fsrs` (MIT, v6.3.0), the official Python library maintained by FSRS creator Jarrett Ye (L.M. Sherlock).

**Passive encounter mapping**: Applying FSRS to vocabulary encountered passively in meetings (rather than traditional flashcard study) is a relatively novel application, though not without precedent. The closest prior work is **Broccoli** (Kämper et al., WWW 2020), which embeds spaced repetition into everyday reading by replacing words with target-language translations -- demonstrating that SRS can work outside traditional flashcard contexts. The spacing effect in incidental learning is supported by Nakata & Elgort (2021), who found that spacing facilitates *explicit* (but not *tacit*) vocabulary knowledge in reading contexts, and by Macis, Sonbul & Alharbi (2021), who studied spacing effects on incidental L2 collocation learning. The novelty in Kotoleaf is applying FSRS specifically to vocabulary from *spoken* meeting contexts, with the scheduling algorithm driving real-time interleaving decisions. Initial approach: treat each contextual encounter as `Rating.Good`; refine with engagement signals (lookups, pauses, correct usage) in later phases. A lower `desired_retention` (0.7-0.8) may be appropriate since passive recognition requires less precision than active recall.

User actions during review:
- **Again** / **Hard** / **Good** / **Easy** -- standard FSRS responses that adjust scheduling
- **Known Forever** -- removes the term from future interleaving entirely (the participant is certain they won't forget it)

### Importing Existing Vocabulary

Language learners who already use SRS tools shouldn't start from zero. Kotoleaf supports importing existing FSRS state so that prior study immediately informs interleaving decisions.

Supported import sources:
- **Anki** -- export via `.apkg` or `.colpkg` files. Anki uses FSRS natively (since v23.10), so scheduling state (stability, difficulty, last review date) maps directly.
- **FSRS-compatible apps** -- any app that exports FSRS parameters (stability, difficulty, due date, reps) can be imported via a standard JSON/CSV format.
- **Vocabulary lists without SRS state** -- plain word lists (e.g. from WaniKani, Memrise, or a personal spreadsheet) can be imported as "Known Forever" or with a configurable default stability, so the system treats them as rooted vocabulary rather than new encounters.

On import, matched terms (by surface form + reading) are merged with any existing Kotoleaf entries. The import state takes precedence for terms not yet encountered in meetings; for terms already tracked in Kotoleaf, the higher stability wins.

This means a participant who has been studying Japanese for years can import their Anki deck on day one and start at Canopy or Deep Root instead of Seedling -- their roots are already partially grown.

### Growth Level Calculation

A participant's growth level is a function of their vocabulary state:

- Terms marked "Known Forever" or with FSRS stability above a threshold = **rooted vocabulary**
- Terms with low stability or recently failed reviews = **still needs interleaving**
- Growth level = `rooted_vocab / total_vocab_encountered`, weighted by FSRS state and term frequency

The level transitions naturally as the participant reviews flashcards and encounters terms repeatedly in meetings. No manual level-setting required -- cold-start is always Seedling.

## Institutional Knowledge

### Glossary

A shared ChibaTech glossary of abbreviations, project names, domain terminology, and preferred translations. Sources:

- **Manual entry** -- team members add terms directly
- **Google Workspace** -- extracted from shared Docs, Slides, and other Workspace content
- **GitHub** -- extracted from repository documentation and READMEs
- **Slack** -- extracted from channel descriptions, pinned messages, and commonly used terms

The glossary ensures consistent translation of ChibaTech-specific terms across all meetings.

### Meeting Materials

Before a meeting, organisers can optionally upload materials (Google Slides, Docs, PDFs). The system:

1. Extracts key terminology with preferred translations in both directions
2. Identifies proper nouns, company names, product names
3. Flags concepts that may need cultural adaptation
4. Generates cultural briefing notes (e.g. "In Japanese business context, X concept is better framed as Y")

Extracted terms become a per-session glossary layered on top of the institutional glossary. This is particularly powerful for the pitch use case -- an English speaker pitching to Japanese executives gets their slides' terminology translated consistently and cultural notes surfaced in real-time.

## Data Retention

Meeting organisers choose retention level per session, mirroring the familiar Google Meet model:

| Level | What's Kept | Default |
|-------|------------|--------|
| **Vocab only** | New terms per user added to SRS. Transcript discarded after meeting. | Yes |
| **Summary** | AI-generated bilingual meeting summary + vocab. Transcript discarded. | |
| **Full transcript** | Complete bilingual transcript + vocab. Kept until organiser deletes. | |
| **Full + audio** | Transcript + original audio recordings. Kept until organiser deletes. | |

The default (vocab only) is the most privacy-preserving option while still serving the learning mission.

## AI Provider Strategy

API-first architecture using three providers: Deepgram (ASR), DeepL or Google Cloud Translation (real-time NMT), and Anthropic (contextual intelligence). Total estimated cost: **~$1.00-1.50 per hour of meeting**.

| Task | Provider | Model | Cost | Latency |
|------|----------|-------|------|---------|
| Speech recognition + diarization + language detection | Deepgram | Nova-3 multilingual | ~$0.67/hr | <300ms streaming |
| Real-time subtitle translation | DeepL or Google Cloud Translation v3 | NMT | ~$0.10-0.15/hr | ~50-100ms |
| Contextual correction + interleaving decisions | Anthropic | Claude Haiku 4.5 | ~$0.15-0.35/hr | ~800-1500ms (with prompt caching) |
| Misunderstanding detection | Anthropic | Claude Haiku 4.5 (inline with correction) | included above | inline |
| Cultural briefing notes | Anthropic | Claude Sonnet 4.6 | ~$0.01/session | off critical path |
| Meeting materials analysis | Anthropic | Claude Sonnet 4.6 | per-meeting, negligible | pre-meeting |
| SRS card generation | Anthropic | Claude Haiku 4.5 | ~$0.06/meeting | post-meeting |

**Why hybrid translation?** Claude Haiku 4.5 averages ~640ms time-to-first-token (llm-benchmarks.com, Feb 2026, n=236) with total call latency of 1.5-2 seconds. Dedicated NMT APIs (DeepL, Google) deliver ~50-100ms, which is essential for real-time subtitle display. The LLM tier handles what NMT cannot: glossary-aware correction, cultural annotations, and the interleaving intelligence that makes Kotoleaf more than a translator. DeepL is preferred for EN-JA quality; Google Cloud Translation is a strong alternative with a generous free tier (500K chars/month).

**Note on Anthropic prompt caching**: System prompts (glossary, context, instructions) are cached for 90% cost reduction on repeated calls. This is essential for keeping the Claude tier affordable at subtitle-generation frequency (~10 calls/minute).

**Note on Japanese tokenisation cost**: Japanese text uses 2-4x more tokens per character than English in LLM APIs. Cost estimates for the Claude tier account for this.

**Note on Gemini**: Gemini may be added later for meeting materials ingestion if 1M token context or multimodal processing (slides with images) is needed. Not required for MVP.

**Note on privacy**: Meeting audio is sent to Deepgram (SOC 2 Type II, HIPAA, GDPR compliant). Transcript text is sent to DeepL/Google and Anthropic. Vocabulary data, institutional glossary, and growth state remain on ChibaTech's GCP infrastructure. This is a deliberate trade-off: API providers deliver code-switching, accent robustness, and translation quality that would take years to build self-hosted.

## Tech Stack

| Layer | Technology | Hosting |
|-------|-----------|--------|
| Frontend | SvelteKit (Svelte 5) or React | Static + CDN, or GCP Cloud Run |
| Real-time transport | LiveKit (WebRTC) or raw WebSocket via FastAPI | Self-hosted on Cloud Run / Fly.io, or LiveKit Cloud |
| Backend API | FastAPI (Python, async) | GCP Cloud Run |
| ASR + diarization + LID | Deepgram Nova-3 multilingual | Deepgram API (streaming WebSocket) |
| Real-time translation | DeepL API or Google Cloud Translation v3 | DeepL / Google API |
| Contextual intelligence | Claude Haiku 4.5 / Claude Sonnet 4.6 | Anthropic API |
| User DB / Vocab / SRS | Firestore (or Supabase/Postgres for stronger relational queries) | GCP / Supabase Cloud |
| Glossary DB | Firestore (or Supabase/Postgres) | GCP / Supabase Cloud |
| Auth | Google Workspace SSO (OAuth 2.0) | Google Identity |
| Meet integration | Open-source bot framework (Attendee, MeetingBaaS) or Playwright; migrate to Google Meet Media API at GA | GCP Cloud Run |

**LiveKit consideration**: The [livekit-examples/live-translated-captioning](https://github.com/livekit-examples/live-translated-captioning) demo implements almost exactly this use case -- LiveKit for WebRTC audio transport, LiveKit Agents (Python) for STT via Deepgram, LLM translation, and per-participant live captions. Adopting LiveKit would eliminate custom audio transport, WebSocket management, and room handling. The LiveKit Agents framework has built-in Deepgram STT plugins.

**Database choice**: Firestore works but FSRS scheduling data is inherently relational (review history, card states, term relationships). Supabase (Postgres) provides full SQL, JOINs, and aggregation queries that are natural for SRS analytics and vocabulary tracking, with a generous free tier (500MB, unlimited API calls) and built-in Google OAuth support.

No GPU required. The Kotoleaf server is a stateless Cloud Run service that orchestrates API calls and manages WebSocket connections. **Cloud Run caveat**: WebSocket connections are subject to a 60-minute maximum timeout. For meetings exceeding 1 hour, client-side reconnection logic is required. Setting `min-instances=1` with always-allocated CPU avoids cold starts (~$14-25/month). Alternative: Fly.io has no WebSocket timeout and comparable pricing.

Estimated infrastructure cost: Cloud Run (~$30-65/month for moderate usage with min-instances) + database (~$0-15/month) + API costs per meeting hour.

## Scaling

The per-participant cost is lightweight because the heavy work (ASR, translation, correction) is shared -- everyone hears the same audio, so there's one pipeline. The per-participant work is just filtering which terms to surface based on their vocabulary database (a database lookup + text formatting).

Scaling is handled by Deepgram and Anthropic's infrastructure, not ours. No GPU provisioning, no cold starts, no VRAM budgeting. Cloud Run auto-scales the orchestration layer. Cost scales linearly with meeting hours, not with infrastructure.

| Scenario | Participants | Interleaving | Compute |
|----------|-------------|--------------|--------|
| Nemawashi (1-to-1) | 2 | Per-person growth level | ~1.0x base |
| Small meeting (in-person) | 3-5 | Per-person growth level | ~1.05x base |
| Meet call (6+) | 6+ | Max Interleaf (single stream) | ~1.0x base |

## English-Japanese Specific Challenges

These are known hard problems that the design must account for:

- **Word order (SOV vs SVO)** -- Japanese puts the verb at the end. JA-to-EN translation requires buffering most of a clause before producing grammatical English. Both DeepL and Claude handle this natively through their understanding of both languages, buffering context as needed before producing translations. No manual buffer configuration required.
- **Subject omission** -- Japanese frequently drops subjects. The Mind layer uses conversation context to infer subjects.
- **Honorifics (keigo)** -- Three levels of politeness with no direct English equivalent. The Mind layer uses social context from the meeting setup to guide appropriate register.
- **Code-switching** -- ChibaTech meetings frequently mix EN and JA in single sentences. Deepgram Nova-3's multilingual mode (`language=multi`) provides native code-switching support with per-word language tags, resolving what was previously the hardest unsolved problem in the pipeline. Feb 2026 improvements reduced code-switching WER by ~21%. No competing API (AssemblyAI, Google Chirp 2, Azure Speech, OpenAI) currently matches Deepgram's per-word EN-JA code-switching capability.
- **Context-dependent meaning** -- Many Japanese expressions carry meaning that depends on tone and social context (e.g. "kentou shimasu" = "I'll consider it" or "no"). This is where misunderstanding detection earns its place.

## Features Reverse-Engineered from Commercial Services

Key capabilities adapted from the commercial landscape:

| Feature | Inspired By | Kotoleaf Adaptation |
|---------|------------|--------------------|
| Context-buffered translation | Flitto (cross-contextual inference) | DeepL real-time translation + Claude contextual correction with conversation history in system prompt |
| Two-tier translation + correction | Flitto (2-stage correction system) | DeepL for speed + Claude Haiku 4.5 for glossary-aware correction and cultural context injection |
| Institutional glossary | Flitto (hyper-personalisation), Palabra (glossary API) | Local glossary from Workspace/GitHub/Slack + per-meeting materials |
| QR-code access | Flitto (no-install audience access) | Web app, no install, Google SSO |
| Glossary-aware speech recognition | Palabra AI | Deepgram keyword boosting + Claude glossary-aware translation |
| Continuous learning loop | Flitto (post-event log analysis) | Vocab tracking + FSRS feeds back into interleaving decisions |
| Material pre-learning | Flitto (pre-event customisation) | Meeting materials upload + term extraction before session |

The key differentiator that no commercial service offers: **adaptive per-participant interleaving that fades as the participant learns** (the growth system).

## MVP Plan

### Phase 1 -- The Nemawashi MVP

The simplest thing that is useful: two people, one conversation, interleaved understanding.

- Web app with subtitle bar
- 1-to-1 mode only (2 participants)
- Deepgram Nova-3 multilingual streaming ASR with code-switching
- DeepL API for real-time subtitle translation (~50-100ms)
- Claude Haiku 4.5 for contextual correction + interleaving decisions
- Cold-start Seedling for everyone (full interleaving)
- Google SSO login
- Basic vocab capture (encountered terms saved to user database, no SRS yet)
- In-person only (device microphones)

**Success metric**: two ChibaTech colleagues have a bilingual nemawashi conversation and both report that the subtitles helped them understand each other better.

### Phase 2 -- The Teacher

The roots start to grow.

- FSRS flashcard review system in the web app
- Growth level calculation from FSRS state
- "Known Forever" marking
- Vocabulary state feeds into interleaving decisions (Seedling through Evergreen transitions)
- Import existing FSRS state from Anki (`.apkg`/`.colpkg`), FSRS-compatible apps (JSON/CSV), or plain vocabulary lists
- Misunderstanding detection inline with contextual correction (Claude Haiku 4.5 flags culturally-loaded expressions)

**Success metric**: a participant who reviews flashcards regularly sees noticeably less interleaving over weeks of meetings, matching their actual comprehension growth.

### Phase 3 -- Institutional Knowledge

The shared root network.

- ChibaTech glossary (manual entry + ingestion from Workspace, GitHub, Slack)
- Meeting materials upload + Claude-powered term extraction (upgrade to Gemini if 1M context or multimodal processing needed)
- Cultural briefing notes from Claude Sonnet 4.6
- Per-meeting session glossary

**Success metric**: an English speaker uploads pitch slides before a meeting with Japanese executives, and domain terms translate consistently throughout the presentation with cultural context surfaced where needed.

### Phase 4 -- Scale Up

From nemawashi to the whole organisation.

- Scale to 3-5 participant in-person meetings (already supported by Deepgram diarization)
- Google Meet bot integration
- Max Interleaf mode for larger calls (6+ participants)
- Data retention controls (vocab only / summary / full transcript / full + audio)
- Evaluate self-hosted ASR/translation for privacy-sensitive deployments (optional migration path)

**Success metric**: a 5-person in-person meeting and a 10-person Google Meet call both run smoothly with appropriate interleaving, and all participants' vocabulary databases are updated with new terms from the meeting.

## Licensing Notes

The API-first approach eliminates most licensing concerns:

| Dependency | License | Note |
|------------|---------|------|
| `py-fsrs` | MIT | No restrictions |
| Deepgram Nova-3 | Commercial API | SOC 2 Type II, HIPAA, GDPR. Data processing agreement available. |
| DeepL API | Commercial API | GDPR compliant. Pro plan required for API access. |
| Anthropic Claude | Commercial API | SOC 2, responsible AI usage policy. |
| LiveKit | Apache-2.0 | Self-hosted or LiveKit Cloud. No restrictions on self-hosted. |
| Playwright | Apache-2.0 | No restrictions (only needed if building custom Meet bot). |

## References

### Spaced Repetition
- Ye, J., Su, J., & Cao, Y. (2022). "A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling." ACM KDD 2022. https://dl.acm.org/doi/10.1145/3534678.3539081
- Nakata, T. & Elgort, I. (2021). "Effects of spacing on contextual vocabulary learning: Spacing facilitates the acquisition of explicit, but not tacit, vocabulary knowledge." *Second Language Research*, 37(2), 233-260. https://journals.sagepub.com/doi/abs/10.1177/0267658320927764
- Kämper, N. et al. (2020). "Sprinkling Lightweight Vocabulary Learning into Everyday Information Diets." ACM WWW 2020. https://dl.acm.org/doi/10.1145/3366423.3380209
- Macis, M., Sonbul, S., & Alharbi, R. (2021). "The Effect of Spacing on Incidental and Deliberate Learning of L2 Collocations." *System*, 103, 102649. https://www.sciencedirect.com/science/article/pii/S0346251X21002037
- FSRS benchmark (10k Anki users): https://github.com/open-spaced-repetition/srs-benchmark
- `py-fsrs`: https://github.com/open-spaced-repetition/py-fsrs

### Speech Recognition (API)
- Deepgram Nova-3: https://deepgram.com/learn/introducing-nova-3-speech-to-text-api
- Deepgram multilingual code-switching: https://developers.deepgram.com/docs/multilingual-code-switching
- Deepgram Nova-3 multilingual update (Feb 2026): https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages
- VoicePing bilingual Whisper architecture: https://voiceping.net/en/blog/whisper-production-real-time-dual-language-switching/

### Code-Switching Research
- CS-FLEURS benchmark (2025): https://arxiv.org/abs/2509.14161
- SwitchLingua (NeurIPS 2025): https://openreview.net/forum?id=N5BB7Or30g
- Code-Switching in End-to-End ASR survey (2025): https://arxiv.org/html/2507.07741v1

### Simultaneous Translation
- SASST -- Syntax-Aware Simultaneous Speech Translation (2025): https://arxiv.org/html/2508.07781v1
- TAF -- Translation by Anticipating Future (NAACL 2025): https://aclanthology.org/2025.naacl-long.286/

### Automatic Post-Editing
- Raunak, V. et al. (2023). "Leveraging GPT-4 for Automatic Translation Post-Editing." https://arxiv.org/pdf/2305.14878v1
- Ki, Y. & Carpuat, M. (2024). "Guiding LLMs to Post-Edit MT with Error Annotations." NAACL Findings. https://arxiv.org/abs/2404.07851

### Google Meet Integration
- Google Meet Media API (Developer Preview): https://developers.google.com/workspace/meet/media-api/guides/overview
- Google Meet Media API reference clients (C++/TypeScript): https://github.com/googleworkspace/meet-media-api-samples
- Recall.ai headless browser bot tutorial (2026): https://www.recall.ai/blog/how-i-built-an-in-house-google-meet-bot
- MeetingBot (open-source, multi-platform): https://github.com/meetingbot/meetingbot
- Attendee (open-source, self-hostable): https://attendee.dev
- CueMeet (open-source): https://cuemeet.ai
- MeetingBaaS (open-source + hosted): https://www.meetingbaas.com
- Zoom RTMS (GA, official real-time media streams): https://developers.zoom.us/docs/rtms/

### Translation APIs
- DeepL API: https://www.deepl.com/en/pro-api
- Google Cloud Translation v3: https://cloud.google.com/translate/pricing
- LLM translation benchmarks (llm-benchmarks.com): https://llm-benchmarks.com/models/anthropic/claudehaiku4520251001

### Real-Time Infrastructure
- LiveKit live-translated-captioning demo: https://github.com/livekit-examples/live-translated-captioning
- LiveKit Agents STT plugins: https://docs.livekit.io/agents/models/stt/

### Self-Hosted Alternatives (for future reference)
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- Silero VAD: https://github.com/snakers4/silero-vad
- NVIDIA Streaming Sortformer (2025): https://arxiv.org/html/2507.18446v1
- Whisper-Streaming: https://github.com/ufal/whisper_streaming
- NLLB Team (2024). "Scaling neural machine translation to 200 languages." *Nature*, 630, 841-846. https://www.nature.com/articles/s41586-024-07335-x
- GemmaX2-28 (NAACL 2025): https://arxiv.org/abs/2502.02481
