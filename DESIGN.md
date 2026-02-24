# Kotoleaf Design Document

## Context

ChibaTech is a bilingual English/Japanese organisation. For large events we use [Flitto](https://flitto.jp) for live simultaneous translation. Flitto's strengths -- context-buffered translation, custom glossaries, and natural-sounding output -- are exactly what we want. But their event-oriented pricing makes them impractical for day-to-day meetings, and sending institutional knowledge to a third party raises privacy concerns.

Kotoleaf is an in-house tool that brings the best of Flitto and the broader simultaneous translation landscape into a system we own, while pursuing a fundamentally different goal: not just translating, but teaching. The leaves fall as the roots grow.

## Design Principles

1. **The roots, not the leaves, are the goal.** Every feature should strengthen the root network -- shared vocabulary, cultural understanding, mutual trust -- between participants. Translation is the means, not the end.

2. **Listen first.** The default is listening, not reading. Always-on subtitles become a crutch that hinders the listening comprehension Kotoleaf exists to develop (Bjork, 1994; Cárdenas & Ramírez Orellana, 2024). Subtitles are a safety net, not the floor -- available on demand when the participant notices they're lost. Looking at a screen during nemawashi breaks eye contact and weakens the human connection the meeting exists to build.

3. **Privacy where it matters.** Meeting audio is sent to Deepgram for ASR; transcript text is sent to Google Cloud Translation (real-time NMT) and Anthropic (contextual intelligence) for processing -- all are SOC 2 Type II and GDPR compliant. Short audio snippets (a few seconds each) are retained per vocabulary term for flashcard review; full audio is discarded unless the organiser opts in. Vocabulary data, institutional glossary, and growth state remain on ChibaTech's GCP infrastructure.

4. **Nemawashi-first design.** The system is designed around 1-to-1 bilingual conversation (nemawashi) as the primary use case. If it works beautifully for two people building consensus, everything else scales from there.

5. **Symmetric.** English and Japanese are treated as equal. The system serves both directions with equal care.

## Modes of Operation

| Mode | Participants | Audio Source |
|------|-------------|--------------|
| **Nemawashi** (1-to-1) | 2 | Device microphones |
| **Small meeting** (in-person) | 3-5 | Device or room microphones, server diarizes |
| **Meet call** (6+) | 6+ | Google Meet bot captures all audio |

In all modes, the ASR pipeline runs continuously in the background, maintaining a rolling transcript buffer. Vocabulary from tap events feeds into each authenticated user's personal database.

### Interaction Modes

Each participant operates in one of two interaction modes, independent of meeting type:

- **Seedling mode** (rolling summaries) -- for beginners and intermediate learners who benefit from continuous support. Instead of always-on subtitles (which become a crutch that hinders listening comprehension), the device displays a rolling bilingual summary of the conversation. Each participant sees summaries in their weaker language only, reinforcing L2 reading comprehension as a parallel learning channel. Summaries update adaptively -- triggered by new substantive utterances rather than a fixed timer -- and highlight what's new since the last round. Tapping drills down from the summary into the raw bilingual context with the confusing term highlighted and explained.
- **Listening mode** (tap-to-reveal) -- the default for advanced participants. The screen stays off. The participant listens naturally, maintains eye contact, and engages in the conversation. When they notice they're lost, they tap the device to receive a compressed bilingual context summary with difficult terms highlighted. The tap itself is a learning signal -- it marks a genuine moment of confusion.

The transition from Seedling to Listening mode is the most meaningful growth milestone. It represents a shift from "I need ongoing support to follow this conversation" to "I can follow on my own and only need help at specific moments." It can be self-selected by the participant or suggested by the system after detecting low summary engagement.

## Architecture

Three processing layers named for the metaphor: Ear (perception), Mind (understanding), Tongue (expression).

```
+---[ Participant Browser ]-------------------------------------------+
|                                                                     |
|  +--[ Kotoleaf Web App ]----------------------------------------+  |
|  |                                                              |  |
|  |  Rolling summary view (Seedling) / dark screen (Listening)   |  |
|  |  Tap-to-reveal drill-down with bilingual context             |  |
|  |  Portrait: split-flip (JP top 180°, EN bottom)               |  |
|  |  Landscape: side-by-side (EN left, JP right)                 |  |
|  |  +--[ Flashcard Review Mode ]--+                             |  |
|  |  | FSRS spaced repetition      |                             |  |
|  |  | Cards with audio snippets   |                             |  |
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
|  |  - Deepgram     - Confusion         - Google Cloud NMT         | |
|  |    Nova-3 API     estimator           (translation)            | |
|  |    (ASR +       - Global/local      - Claude Haiku 4.5         | |
|  |    diarization    context mgmt        (rolling summaries,      | |
|  |    + LID)       - Growth tracking     tap drill-down)          | |
|  |  - Rolling      - Glossary lookup  - Split-flip display        | |
|  |    audio buffer                    - Audio snippet capture     | |
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
|  | MeetingBaaS / Attendee |    | Google Cloud Translation (NMT)  |  |
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

For Google Meet calls (Phase 4), a bot joins the meeting and captures audio server-side. Options include open-source frameworks (MeetingBaaS, Attendee, MeetingBot) or a custom Playwright headless browser, with migration to the Google Meet Media API when it reaches GA. The headless browser approach carries **Terms of Service risk**. For in-person meetings (Phase 1-3), audio comes from each participant's device microphone.

Cost: ~$0.0092/min ($0.55/hr) for multilingual streaming + $0.0020/min diarization = ~$0.67/hr total.

### Mind (Understanding)

The intelligence layer. Maintains per-participant state and detects moments that matter.

- **Confusion Estimator** -- when a participant taps, the Mind identifies which word or phrase most likely caused confusion. It cross-references the tap timestamp against the rolling transcript, the participant's vocabulary database, and term difficulty to produce a best guess. This guess becomes the flashcard candidate.
- **Misunderstanding Detection** -- continuously monitors the conversation for moments where meaning is likely to be lost: false cognates, ambiguous grammar, cultural context gaps, or concepts that don't translate directly (e.g. detecting that "kentou shimasu" often means "no" rather than the literal "I'll consider it"). In Listening mode, detected misunderstandings trigger a **silent nudge** (device vibration) rather than automatic subtitles -- the participant decides whether to tap.
- **Glossary Lookup** -- checks terms against the institutional glossary (ChibaTech-specific abbreviations, project names, domain terminology) and any per-meeting session glossary from uploaded materials
- **Growth Tracking** -- monitors tap frequency over time as the primary growth signal. A participant whose taps decrease from 15/meeting to 3/meeting over weeks is demonstrably growing, and the data comes free from natural interaction.

The Mind's output differs by interaction mode: in Seedling mode, it maintains the two-tier context (global + local) and triggers summarization rounds based on new substantive utterances. In Listening mode, it produces silent nudges and, on tap, identifies the confusing segment for the context summary. In both modes, tap events feed the participant's vocabulary database.

### Tongue (Expression)

Produces output appropriate to each participant's interaction mode.

#### Seedling Mode (rolling summaries)

For participants who benefit from continuous support. Instead of always-on subtitles, Seedling mode provides a rolling summary of the conversation that each participant reads in their weaker language -- reinforcing L2 reading comprehension as a parallel learning channel.

The summarization system uses a **two-tier context architecture**:

- **Global context** -- a priority-ordered free-form list of key facts, decisions, and reference points accumulated over the entire conversation. This list is injected into every summarization round so the LLM maintains awareness of important information from earlier in the conversation without needing the full transcript history. Items can be added, updated, corrected, reordered, or removed as the conversation evolves. Hard cap of ~15 items; when a new crucial item arrives, it displaces the lowest-priority item.
- **Local context** -- the raw transcript from the last ~30 seconds (the most recent substantive utterances), providing immediate conversational context.

Each summarization round:

1. **Claude Haiku 4.5** receives the current global context list + the local transcript window.
2. Claude produces: a bilingual summary of new information (EN + JP), an updated global context list (full replacement), and an `is_new` flag.
3. The output is structured as a tool call (similar to a todo list update), enabling schema validation and clean state management.
4. If `is_new: true`, the display updates with the new summary line highlighted and previous lines dimmed. If `is_new: false`, no display update occurs.
5. All terms surfaced in summaries are passively captured for the vocabulary database.

**Summarization trigger**: rounds are triggered adaptively by new substantive utterances (configurable threshold, default: 3 utterances of ≥5 words or ≥3 seconds duration), with a maximum interval ceiling (~45 seconds) and a minimum cooldown (~8 seconds). This filters backchanneling and aizuchi while ensuring updates during long monologues.

**Google Cloud Translation v3** (NMT or Gemini-powered TLLM) handles translation within the summarization pipeline. $20/million characters with a 500K chars/month free tier.

#### Listening Mode (tap-to-reveal)

The default for advanced participants. The screen stays dark. The participant listens, maintains eye contact, and engages naturally. When they tap:

1. The Ear's rolling transcript buffer provides the last ~30 seconds of conversation with word-level timestamps.
2. The Mind's confusion estimator identifies the likely problematic term or phrase based on the tap timestamp, the participant's vocabulary state, and term difficulty.
3. **Google Cloud Translation v3** translates the buffered segment (~50-100ms, well within the user's patience for an on-demand request).
4. **Claude Haiku 4.5** compresses the translated segment into a concise bilingual context summary: the key point of what was said, with the estimated confusing term highlighted and explained.
5. The device displays the summary for a few seconds, then auto-dims.
6. The confusing term, its context sentence, and a **short audio snippet** (clipped from the rolling audio buffer using Deepgram's word-level timestamps) are saved to the participant's vocabulary database for post-meeting flashcard review.

#### Tap as Drill-Down (Both Modes)

In Seedling mode, tap serves as a **drill-down** from the rolling summary into raw bilingual context. The participant reads a summary line in their weak language, doesn't fully understand it, and taps to see the specific transcript segment with the confusing term highlighted and explained. This unifies the tap interaction across both modes:

- **Seedling**: summary visible → tap drills into detail → returns to summary
- **Listening**: screen dark → tap reveals context summary → screen dims

In both modes, the tap location on the display determines **which participant** is confused:

- **Tap on JP side** (portrait top / landscape right) → the EN-native learner needs clarification. The confusing Japanese term and context are saved to their vocabulary database.
- **Tap on EN side** (portrait bottom / landscape left) → the JP-native learner needs clarification. The confusing English term and context are saved to their vocabulary database.

The physical layout of the device is the user identification system -- no login or session setup is needed to track per-participant vocabulary in Phase 1.

**Tap debouncing**: taps are debounced with a ~5-second cooldown. If the participant taps again while a drill-down is displayed, the context window extends backward rather than generating a new summary. This is cheaper, faster, and more useful for catching moments the participant missed.

#### Silent Nudge

When the Mind detects a likely misunderstanding in Listening mode (false cognates, culturally loaded expressions, ambiguous grammar), the device **vibrates without showing anything**. The participant can choose to tap or to keep listening. This preserves the listen-first default while flagging moments that deserve attention.

#### Per-User Filter

The lightweight step that makes personalisation cheap. The heavy work (ASR, translation) is shared across all participants. The filter operates on tap events -- "this participant tapped at timestamp T, here are the terms they likely didn't know" -- rather than filtering every utterance in real time.

### Display Model

The display layout adapts to device orientation, serving both single-viewer and shared-device use cases.

#### Portrait (phone flat on table between two speakers)

The phone is placed flat on the table as a shared artifact. The screen splits horizontally at the midline:

- **Top half**: Japanese text, rotated 180° (readable by the person sitting across the table). Text grows from the top edge toward the center -- newest content appears closest to the JP-side reader.
- **Bottom half**: English text, right-side up. Text grows from the bottom edge toward the center -- newest content appears closest to the EN-side reader.

Each participant sees only their **weaker language** on their side -- the EN-native reads Japanese summaries, the JP-native reads English summaries. The summary itself becomes L2 reading practice, with tap available as a safety net.

Layout is hardcoded (JP top, EN bottom). Participants rotate the phone if needed.

#### Landscape (tablet or shared screen)

Two columns, both right-side up:

- **Left column**: English summaries
- **Right column**: Japanese summaries

Suitable for tablets, laptops, or shared displays where both participants face the same direction.

#### Delta Highlighting

In both orientations, the display highlights what's new since the last summarization round. Previous summary lines are dimmed but remain visible. This allows participants to see both "what's happening now" and "what happened earlier" at a glance without the distraction of a full refresh.

When `is_new: false` (no new information since last round), the display does not update -- avoiding unnecessary visual changes during pauses or backchanneling.

## Growth System

The growth system is how Kotoleaf becomes its own obsolescence. Leaves fall as roots grow.

### Vocabulary Tracking

In Listening mode, vocabulary capture is driven by taps. When a participant taps, the Mind estimates which term caused confusion and saves it with rich context:

```
Term:      稟議 (りんぎ)
Meaning:   Ringi -- formal approval process where a proposal document
           circulates through management for consensus
Context:   "この案件は稟議を通す必要があります"
           (This matter needs to go through the ringi process)
Audio:     [3.2s clip, speaker: Tanaka-san, clipped from rolling buffer
           using Deepgram word-level timestamps]
Meeting:   2026-02-21, Meeting with Tanaka-san
Source:    tap (timestamp 14:32:07, confidence: 0.82)
Tags:      [business, ChibaTech, approval-process]
```

The audio snippet is the key differentiator from traditional flashcards. Hearing the term in the original speaker's voice, accent, speed, and conversational context provides listening practice that isolated audio recordings cannot match. Snippets are clipped from the Ear's rolling audio buffer using Deepgram's word-level timestamps, typically 2-5 seconds centered on the target term.

In Seedling mode, vocabulary is captured through two channels: passively from terms surfaced in rolling summaries, and actively from tap drill-downs (which produce the same high-quality confusion signal as Listening mode taps, including audio snippets). Since each participant reads summaries in their weaker language, the terms they tap on are precisely the vocabulary they need to learn.

### Spaced Repetition (FSRS)

Encountered terms become flashcards in a personal database, reviewed using the FSRS algorithm (the modern successor to SM-2, used natively by Anki since v23.10, default since ~2026). FSRS-6 (21 parameters, latest version) is backed by a peer-reviewed ACM KDD paper (Ye, Su & Cao, 2022) and shows ~99% superiority over SM-2 with optimised parameters across the open-spaced-repetition benchmark (dataset of 10,000-20,000 Anki users; exact figures vary by version). Implementation uses `py-fsrs` (MIT, v6.3.0), the official Python library maintained by FSRS creator Jarrett Ye (L.M. Sherlock).

**Tap-driven encounter mapping**: Applying FSRS to vocabulary identified through tap events in meetings is a novel application, though grounded in established principles. The closest prior work is **Broccoli** (Kämper et al., WWW 2020), which embeds spaced repetition into everyday reading by replacing words with target-language translations -- demonstrating that SRS can work outside traditional flashcard contexts. The spacing effect in incidental learning is supported by Nakata & Elgort (2021), who found that spacing facilitates *explicit* (but not *tacit*) vocabulary knowledge in reading contexts, and by Macis, Sonbul & Alharbi (2021), who studied spacing effects on incidental L2 collocation learning.

The tap-to-reveal model improves on passive encounter mapping in a critical way: each tap is an **active signal of confusion**, not a passive exposure. This produces higher-quality input for FSRS because the system knows the participant genuinely didn't understand the term, rather than guessing from proximity. Initial approach: treat each tap-identified term as `Rating.Again` (the participant was confused); treat terms the participant later uses correctly in conversation as `Rating.Good`. A `desired_retention` of 0.8-0.85 is appropriate since the goal is recognition in spoken context, not production.

User actions during review:
- **Again** / **Hard** / **Good** / **Easy** -- standard FSRS responses that adjust scheduling
- **Known Forever** -- removes the term from future review and tap-based surfacing entirely (the participant is certain they won't forget it)

### Importing Existing Vocabulary

Language learners who already use SRS tools shouldn't start from zero. Kotoleaf supports importing existing FSRS state so that prior study immediately informs the system's confusion estimation and interaction mode suggestions.

Supported import sources:
- **Anki** -- export via `.apkg` or `.colpkg` files. Anki uses FSRS natively (since v23.10), so scheduling state (stability, difficulty, last review date) maps directly.
- **FSRS-compatible apps** -- any app that exports FSRS parameters (stability, difficulty, due date, reps) can be imported via a standard JSON/CSV format.
- **Vocabulary lists without SRS state** -- plain word lists (e.g. from WaniKani, Memrise, or a personal spreadsheet) can be imported as "Known Forever" or with a configurable default stability, so the system treats them as rooted vocabulary rather than new encounters.

On import, matched terms (by surface form + reading) are merged with any existing Kotoleaf entries. The import state takes precedence for terms not yet encountered in meetings; for terms already tracked in Kotoleaf, the higher stability wins.

This means a participant who has been studying Japanese for years can import their Anki deck on day one and start directly in Listening mode instead of Seedling -- their roots are already partially grown.

### Growth Level Calculation

Growth is measured by two complementary signals:

- **Tap frequency** -- the primary real-time signal. Taps per meeting, tracked over time, directly measures how often the participant gets lost. Decreasing tap frequency = growing comprehension. This data comes free from natural interaction.
- **FSRS vocabulary state** -- the study signal. Terms marked "Known Forever" or with stability above a threshold = **rooted vocabulary**. Terms with low stability or recently failed reviews = **still growing**.

Growth level = a composite of tap frequency trend and `rooted_vocab / total_vocab_encountered`, weighted by FSRS state and term frequency.

The system suggests transitioning from Seedling to Listening mode when vocabulary state indicates sufficient foundation. The participant always has final say -- the transition is a personal commitment to try listening first. Cold-start is always Seedling.

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

Meeting organisers choose retention level per session:

| Level | What's Kept | Default |
|-------|------------|--------|
| **Vocab + snippets** | Tap-identified terms with audio snippets (2-5s each) added to SRS. Rolling transcript/audio buffer discarded after meeting. | Yes |
| **Summary** | AI-generated bilingual meeting summary + vocab + snippets. Buffer discarded. | |
| **Full transcript** | Complete bilingual transcript + vocab + snippets. Kept until organiser deletes. | |
| **Full + audio** | Transcript + complete audio recordings + vocab + snippets. Kept until organiser deletes. | |

The default (vocab + snippets) retains only the short audio clips associated with vocabulary flashcards -- typically a few dozen clips of 2-5 seconds each per meeting. The rolling transcript and audio buffers are discarded after the meeting ends. This is a middle ground: enough audio for effective flashcard review, without retaining a full recording.

## AI Provider Strategy

API-first architecture. In Listening mode (tap-to-reveal), the system only calls translation and LLM APIs when the participant taps -- dramatically reducing cost compared to per-utterance processing. In Seedling mode, Claude runs periodic summarization rounds triggered by new substantive utterances, with Google Cloud Translation handling the bilingual output.

| Task | Provider | Model | Cost | Latency | When |
|------|----------|-------|------|---------|------|
| Speech recognition + diarization + language detection | Deepgram | Nova-3 multilingual | ~$0.67/hr | <300ms streaming | Always (both modes) |
| Rolling summary generation (Seedling mode) | Anthropic | Claude Haiku 4.5 | ~$0.30-0.65/hr | ~800-1500ms | Seedling: every 3+ utterances |
| Summary translation (Seedling mode) | Google Cloud Translation v3 | NMT (or TLLM) | ~$0.05-0.10/hr | ~50-100ms | Seedling: per round |
| Context summary translation (Listening mode) | Google Cloud Translation v3 | NMT (or TLLM) | ~$0.01-0.05/hr | ~50-100ms | Listening: on tap |
| Context compression + confusion estimation | Anthropic | Claude Haiku 4.5 | ~$0.02-0.10/hr | ~800-1500ms | Listening: on tap |
| Misunderstanding detection | Anthropic | Claude Haiku 4.5 | ~$0.05-0.15/hr | inline | Both modes |
| Cultural briefing notes | Anthropic | Claude Sonnet 4.6 | ~$0.01/session | off critical path | Pre-meeting |
| Meeting materials analysis | Anthropic | Claude Sonnet 4.6 | per-meeting, negligible | pre-meeting | Pre-meeting |
| Flashcard generation + audio clipping | Anthropic | Claude Haiku 4.5 | ~$0.03/meeting | post-meeting | Post-meeting |

Estimated total cost: **~$0.75-1.00/hr in Listening mode**, **~$1.05-1.45/hr in Seedling mode**. Listening mode is cheaper because Claude is only called on tap. Seedling mode calls Claude for periodic summarization rounds (adaptive, roughly every 10-30 seconds depending on conversation pace), but this is still dramatically cheaper than per-utterance processing because the two-tier context architecture keeps input tokens small (~1000 tokens/round: global context + local transcript + system prompt).

**Why the tap-to-reveal model changes cost dynamics:** In Listening mode, Claude is only called when the participant taps -- perhaps 5-15 times per hour. This makes Claude's 800-1500ms latency a non-issue (the participant is waiting for a thoughtful summary, not streaming subtitles). In Seedling mode, Claude is called per summarization round (~120-360 times/hr depending on conversation density), but with small payloads and structured output (tool call pattern). The per-round cost is ~$0.002, making Claude's contribution to Seedling mode ~$0.30-0.65/hr.

**Why Google Cloud Translation?** ChibaTech is a Google Workspace organisation, so Google Cloud Translation shares billing, IAM, and Cloud Storage with the rest of the GCP stack. NMT pricing ($20/M chars) is competitive, with a free tier of 500K chars/month. The Gemini-powered TLLM model offers higher quality at the same effective price. Adaptive Translation can be steered with example sentence pairs for consistent register -- a lighter-weight customisation path than training custom models. Google explicitly does not store or train on API-submitted text.

**Google Cloud Translation models**: NMT ($20/M chars) is fastest and cheapest -- start here. TLLM (Gemini-powered, $10/M input + $10/M output) offers higher quality if needed. Adaptive Translation ($25/M input + $25/M output) steers with example sentence pairs for consistent register.

**Implementation notes**: Japanese text uses 2-4x more LLM tokens than English (cost estimates account for this). Anthropic prompt caching (90% cost reduction) is valuable for Seedling mode summarization rounds (~120-360 calls/hr with similar system prompts) and useful in Listening mode (5-15 taps/hr). Gemini may be added later for meeting materials ingestion (1M context, multimodal). All API providers are SOC 2 Type II and GDPR compliant.

## Tech Stack

| Layer | Technology | Hosting |
|-------|-----------|--------|
| Frontend | SvelteKit (Svelte 5) | Static + CDN, or GCP Cloud Run |
| Real-time transport | LiveKit (WebRTC) | LiveKit Cloud, or self-hosted on Cloud Run / Fly.io |
| Backend API | FastAPI (Python, async) | GCP Cloud Run |
| ASR + diarization + LID | Deepgram Nova-3 multilingual | Deepgram API (streaming WebSocket) |
| Translation | Google Cloud Translation v3 (NMT / TLLM) | Google Cloud API |
| Contextual intelligence | Claude Haiku 4.5 / Claude Sonnet 4.6 | Anthropic API |
| User DB / Vocab / SRS | Firestore | GCP |
| Glossary DB | Firestore | GCP |
| Auth | Google Workspace SSO (OAuth 2.0) | Google Identity |
| Meet integration (Phase 4) | MeetingBaaS or Attendee; migrate to Google Meet Media API at GA | GCP Cloud Run |

**Why LiveKit**: The [livekit-examples/live-translated-captioning](https://github.com/livekit-examples/live-translated-captioning) demo implements almost exactly this use case -- LiveKit for WebRTC audio transport, LiveKit Agents (Python) for STT via Deepgram, and per-participant output. Adopting LiveKit eliminates custom audio transport, WebSocket management, and room handling.

**Why Firestore over Postgres**: ChibaTech is a Google Workspace org -- Firestore shares billing, IAM, and the GCP stack. FSRS card state is per-user key-value data (not relational JOINs). If SRS analytics later demand relational queries, migrate vocabulary tables to Supabase/Postgres.

No GPU required. The Kotoleaf server is a stateless Cloud Run service that orchestrates API calls and manages WebSocket connections. **Cloud Run caveat**: WebSocket connections are subject to a 60-minute maximum timeout. For meetings exceeding 1 hour, client-side reconnection logic is required. Setting `min-instances=1` with always-allocated CPU avoids cold starts (~$14-25/month). Alternative: Fly.io has no WebSocket timeout and comparable pricing.

Estimated infrastructure cost: Cloud Run (~$30-65/month for moderate usage with min-instances) + database (~$0-15/month) + API costs per meeting hour.

## Scaling

The per-participant cost is lightweight because the heavy work (ASR, audio buffering) is shared -- everyone hears the same audio, so there's one pipeline. The per-participant work is processing tap events (a database lookup + translation call + audio snippet extraction), which happens only when a participant taps.

Scaling is handled by Deepgram's infrastructure, not ours. No GPU provisioning, no cold starts, no VRAM budgeting. Cloud Run auto-scales the orchestration layer. Cost scales linearly with meeting hours, not with infrastructure.

| Scenario | Participants | Interaction | Compute |
|----------|-------------|-------------|--------|
| Nemawashi (1-to-1) | 2 | Per-person mode (Seedling or Listening) | ~1.0x base |
| Small meeting (in-person) | 3-5 | Per-person mode | ~1.05x base |
| Meet call (6+) | 6+ | Rolling summaries for all (Seedling-equivalent) | ~1.0x base |

## English-Japanese Specific Challenges

These are known hard problems that the design must account for:

- **Word order (SOV vs SVO)** -- Japanese puts the verb at the end. JA-to-EN translation requires buffering most of a clause before producing grammatical English. Both Google Cloud Translation and Claude handle this natively through their understanding of both languages, buffering context as needed before producing translations. No manual buffer configuration required.
- **Subject omission** -- Japanese frequently drops subjects. The Mind layer uses conversation context to infer subjects.
- **Honorifics (keigo)** -- Three levels of politeness with no direct English equivalent. The Mind layer uses social context from the meeting setup to guide appropriate register.
- **Code-switching** -- ChibaTech meetings frequently mix EN and JA in single sentences. Deepgram Nova-3's multilingual mode (`language=multi`) provides native code-switching support with per-word language tags, resolving what was previously the hardest unsolved problem in the pipeline. Feb 2026 improvements reduced code-switching WER by ~21%. No competing API (AssemblyAI, Google Chirp 2, Azure Speech, OpenAI) currently matches Deepgram's per-word EN-JA code-switching capability.
- **Context-dependent meaning** -- Many Japanese expressions carry meaning that depends on tone and social context (e.g. "kentou shimasu" = "I'll consider it" or "no"). This is where misunderstanding detection earns its place.

## MVP Plan

### Phase 1 -- The Nemawashi MVP

The simplest thing that is useful: two people, one conversation, a safety net when you're lost.

- Web app with both interaction modes:
  - **Seedling mode**: rolling bilingual summaries with two-tier context (global + local), adaptive summarization trigger, delta highlighting
  - **Listening mode**: dark screen with tap-to-reveal context summaries
  - Tap as drill-down in Seedling, tap as reveal in Listening
- Portrait split-flip display (JP top 180°, EN bottom) + landscape side-by-side (EN left, JP right)
- Side-based participant identification: tap location determines which participant's vocabulary database receives the confusion event
- 1-to-1 mode only (2 participants)
- Deepgram Nova-3 multilingual streaming ASR with code-switching + rolling audio buffer
- Google Cloud Translation v3 for translation (~50-100ms)
- Claude Haiku 4.5 for context compression on tap and rolling summarization (tool call output with global context management)
- Google SSO login
- Basic vocab capture from taps: term, context sentence, and audio snippet saved to per-participant database (no SRS scheduling yet)
- In-person only (device microphones)
- Configurable summarization thresholds (utterance count, word/duration minimums, interval bounds)

**Not in Phase 1**: FSRS scheduling, flashcard review UI, misunderstanding detection (silent nudge), institutional glossary, sentiment analysis, targeted drill-down (tapping specific summary phrases). Phase 1 validates the core interaction: do rolling summaries in L2 + tap-to-reveal drill-downs help people have better bilingual conversations?

**Success metric**: two ChibaTech colleagues have a bilingual nemawashi conversation and both report that (a) they felt more present in the conversation than with always-on subtitles, (b) the rolling summaries helped them follow along in their weaker language, and (c) the tap drill-down clarified moments of confusion.

### Phase 2 -- The Teacher

The roots start to grow.

- FSRS flashcard review system in the web app, with in-situ audio snippet playback
- Growth level calculation from tap frequency trend + FSRS vocabulary state
- "Known Forever" marking
- Import existing FSRS state from Anki (`.apkg`/`.colpkg`), FSRS-compatible apps (JSON/CSV), or plain vocabulary lists
- Silent nudge feature: misunderstanding detection via Claude (device vibrates on detected false cognates, culturally loaded expressions, ambiguous grammar -- participant chooses whether to tap)
- **Targeted drill-down**: tappable phrases within rolling summaries. Instead of a generic tap, the participant taps a specific summary phrase to drill into that exact transcript segment. Requires Claude to output anchor references linking summary phrases to transcript timestamps.
- **Sentiment analysis from audio layer**: prosody, hesitation, pitch, and breath timing carry more honest sentiment signal than text (especially through the tatemae filter in Japanese business communication). Audio-layer sentiment is a fundamentally different feature from text summarization and benefits from dedicated audio analysis rather than LLM text inference.

**Success metric**: a participant who reviews flashcards with audio snippets regularly shows decreasing tap frequency over weeks of meetings, matching their actual comprehension growth. They transition from Seedling to Listening mode and stay there.

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
- Rolling summary mode for all participants in larger calls (6+ participants) on individual devices
- Data retention controls (vocab + snippets / summary / full transcript / full + audio)
- Evaluate self-hosted ASR/translation for privacy-sensitive deployments (optional migration path)

**Success metric**: a 5-person in-person meeting and a 10-person Google Meet call both run smoothly, and all participants' vocabulary databases are updated with new terms from the meeting.

## Licensing Notes

The API-first approach eliminates most licensing concerns:

| Dependency | License | Note |
|------------|---------|------|
| `py-fsrs` | MIT | No restrictions |
| Deepgram Nova-3 | Commercial API | SOC 2 Type II, HIPAA, GDPR. Data processing agreement available. |
| Google Cloud Translation | Commercial API | GDPR compliant. Data not stored or used for training. Free tier 500K chars/month. |
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

### Caption Reduction & Listening Pedagogy
- Cárdenas, M. & Ramírez Orellana, D. (2024). "Progressive Reduction of Captions in Language Learning." *Journal of Information Technology Education: Innovations in Practice*, 23, 002. https://doi.org/10.28945/5263
- Montero Perez, M., Van Den Noortgate, W., & Desmet, P. (2013). "Captioned video for L2 listening and vocabulary learning: A meta-analysis." *System*, 41(3), 720-739. https://www.sciencedirect.com/science/article/pii/S0346251X13001012
- Vanderplank, R. (2016). *Captioned Media in Foreign Language Learning and Teaching*. Palgrave Macmillan.
- Vandergrift, L. & Goh, C. C. M. (2012). *Teaching and Learning Second Language Listening: Metacognition in Action*. Routledge.
- Bjork, R. A. (1994). "Memory and metamemory considerations in the training of human beings." In J. Metcalfe & A. Shimamura (Eds.), *Metacognition: Knowing about knowing* (pp. 185-205). MIT Press.
- Bjork, R. A. & Bjork, E. L. (2011). "Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning." In M. A. Gernsbacher et al. (Eds.), *Psychology and the real world* (pp. 56-64). Worth.

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
- Google Cloud Translation v3: https://cloud.google.com/translate/docs/overview
- Google Cloud Translation pricing: https://cloud.google.com/translate/pricing
- Google Cloud Translation glossaries: https://cloud.google.com/translate/docs/advanced/glossary
- Google Cloud Adaptive Translation: https://cloud.google.com/translate/docs/advanced/adaptive-translation
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
