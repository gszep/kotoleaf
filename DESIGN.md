# Kotoleaf Design Document

## Context

ChibaTech is a bilingual English/Japanese organisation. For large events we use [Flitto](https://flitto.jp) for live simultaneous translation. Flitto's strengths -- context-buffered translation, custom glossaries, and natural-sounding output -- are exactly what we want. But their event-oriented pricing makes them impractical for day-to-day meetings, and sending institutional knowledge to a third party raises privacy concerns.

Kotoleaf is an in-house tool that brings the best of Flitto and the broader simultaneous translation landscape into a system we own, while pursuing a fundamentally different goal: not just translating, but teaching. The leaves fall as the roots grow.

## Design Principles

1. **The roots, not the leaves, are the goal.** Every feature should strengthen the root network -- shared vocabulary, cultural understanding, mutual trust -- between participants. Translation is the means, not the end.

2. **Privacy by default.** Institutional knowledge stays on our infrastructure. Meeting data retention is controlled by organisers. The default is to keep only vocabulary growth, discarding transcripts.

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
+---[ GCP ]-------------------------------------------------------+
|                                                                  |
|  +--[ Kotoleaf Server ]-----------------------------------------+|
|  |                                                              ||
|  |  Ear ────────> Mind ────────> Tongue                         ||
|  |  - faster-whisper   - Comprehension    - NLLB/NLLW           ||
|  |  - Silero VAD         model            - Claude (correction) ||
|  |  - Sortformer       - Growth level     - Interleaver         ||
|  |    diarization        calculator       - Per-user filter     ||
|  |                     - Glossary lookup                        ||
|  |                     - Misunderstanding                       ||
|  |                       detection                              ||
|  +---+-------------------+-------------------+------------------+|
|      |                   |                   |                   |
|  +---+-------+  +--------+-----------+  +----+-------------+    |
|  | User      |  | Institutional      |  | Meeting          |    |
|  | Vocab     |  | Glossary           |  | Materials        |    |
|  | SRS (FSRS)|  | (ChibaTech terms)  |  | (per-session)    |    |
|  +-----------+  | from Workspace,    |  | Slides, Docs,    |    |
|                 | GitHub, Slack      |  | briefing notes   |    |
|                 +--------------------+  +------------------+    |
|                                                                  |
|  +--[ Google Meet Bot ]--+                                       |
|  | Joins Meet calls      |                                       |
|  | Captures audio        |                                       |
|  | Routes to Ear         |                                       |
|  +-----------------------+                                       |
+------------------------------------------------------------------+
```

### Ear (Perception)

Captures live audio and converts it to text with speaker attribution.

- **Voice Activity Detection** (Silero VAD) -- reduces compute when nobody is speaking
- **Speech Recognition** (faster-whisper, large-v3-turbo) -- multilingual ASR, 99+ languages, runs on GPU
- **Speaker Diarization** (Streaming Sortformer) -- identifies who is speaking
- **Language Detection** -- determines which language each speaker is using (handles code-switching where EN and JA are mixed in a single sentence)

For Google Meet calls, a Kotoleaf bot joins the meeting via the Google Meet REST API and captures participant audio server-side. For in-person meetings, audio comes from each participant's device microphone.

### Mind (Understanding)

The intelligence layer. Maintains per-participant state and decides what to surface.

- **Comprehension Model** -- tracks each participant's known vocabulary and estimates whether they understood what was just said
- **Growth Level Calculator** -- determines each participant's current level (Seedling / Canopy / Deep Root / Evergreen) based on their FSRS vocabulary state
- **Glossary Lookup** -- checks terms against the institutional glossary (ChibaTech-specific abbreviations, project names, domain terminology) and any per-meeting session glossary from uploaded materials
- **Misunderstanding Detection** -- identifies moments where meaning is likely to be lost: false cognates, ambiguous grammar, cultural context gaps, or concepts that don't translate directly (e.g. detecting that "kentou shimasu" often means "no" rather than the literal "I'll consider it")

The Mind's output for each term is a decision: **surface** (include in this participant's interleaving) or **trust** (the roots are strong enough, let it pass).

### Tongue (Expression)

Produces personalised output for each participant.

- **Translation** (NLLW/NLLB, distilled 1.3B) -- simultaneous streaming translation, self-hosted, no per-token cost
- **Two-Stage Correction** -- initial fast translation from NLLB, followed by a Claude Haiku refinement pass that fixes contextual errors, cultural nuances, and metaphors
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

Encountered terms become flashcards in a personal database, reviewed using the FSRS algorithm (the modern successor to SM-2, used by Anki).

User actions during review:
- **Again** / **Hard** / **Good** / **Easy** -- standard FSRS responses that adjust scheduling
- **Known Forever** -- removes the term from future interleaving entirely (the participant is certain they won't forget it)

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

A mix of self-hosted models (for latency-sensitive, high-volume work) and API calls (for intelligence tasks where quality matters more than speed).

| Task | Provider | Rationale |
|------|----------|----------|
| Speech recognition | **faster-whisper** (self-hosted) | No API dependency, lowest latency |
| Translation (bulk, streaming) | **NLLW/NLLB** (self-hosted) | Simultaneous streaming, no per-token cost |
| Two-stage correction | **Claude Haiku** (Anthropic API) | Fast, cheap, excellent contextual refinement |
| Misunderstanding detection | **Claude Sonnet** (Anthropic API) | Needs deeper cultural/linguistic reasoning |
| Material ingestion | **Gemini** (Google AI API) | Native Google Workspace access |
| Cultural briefing notes | **Claude Sonnet** (Anthropic API) | Nuanced cross-cultural communication |
| Term extraction from materials | **Gemini Flash** (Google AI API) | High volume, lower cost |
| SRS card generation | **Claude Haiku** (Anthropic API) | Good context summaries at scale |

## Tech Stack

| Layer | Technology | Hosting |
|-------|-----------|--------|
| Frontend | Web app (TBD framework) | GCP Cloud Run or static + CDN |
| Audio transport | WebSocket | GCP Cloud Run |
| ASR | faster-whisper (large-v3-turbo) | GCP Compute Engine, L4 GPU |
| VAD | Silero VAD | Same GPU instance |
| Diarization | Streaming Sortformer | Same GPU instance |
| Translation | NLLW/NLLB (distilled 1.3B) | Same GPU instance |
| LLM (correction, detection) | Claude Haiku / Sonnet | Anthropic API |
| LLM (ingestion, extraction) | Gemini / Gemini Flash | Google AI API |
| User DB / Vocab / SRS | Firestore or Cloud SQL | GCP |
| Glossary DB | Firestore | GCP |
| Auth | Google Workspace SSO | Google Identity |
| Meet integration | Google Meet REST API (bot) | GCP Cloud Run |

GPU requirement: a single L4 (24GB VRAM, ~$0.80/hr on GCP) handles the full self-hosted pipeline for up to 5 participants with per-person interleaving.

## Scaling

The per-participant cost is lightweight because the heavy work (ASR, translation, correction) is shared -- everyone hears the same audio, so there's one pipeline. The per-participant work is just filtering which terms to surface based on their vocabulary database (a database lookup + text formatting, not a GPU task).

| Scenario | Participants | Interleaving | Compute |
|----------|-------------|--------------|--------|
| Nemawashi (1-to-1) | 2 | Per-person growth level | ~1.0x base |
| Small meeting (in-person) | 3-5 | Per-person growth level | ~1.05x base |
| Meet call (6+) | 6+ | Max Interleaf (single stream) | ~1.0x base |

## English-Japanese Specific Challenges

These are known hard problems that the design must account for:

- **Word order (SOV vs SVO)** -- Japanese puts the verb at the end. JA-to-EN translation requires buffering most of a clause before producing grammatical English. EN-to-JA is more tractable incrementally. The Ear layer uses asymmetric buffer sizes per language direction.
- **Subject omission** -- Japanese frequently drops subjects. The Mind layer uses conversation context to infer subjects.
- **Honorifics (keigo)** -- Three levels of politeness with no direct English equivalent. The Mind layer uses social context from the meeting setup to guide appropriate register.
- **Code-switching** -- ChibaTech meetings likely mix EN and JA in single sentences. No off-the-shelf solution exists; this requires custom work in the Ear layer.
- **Context-dependent meaning** -- Many Japanese expressions carry meaning that depends on tone and social context (e.g. "kentou shimasu" = "I'll consider it" or "no"). This is where misunderstanding detection earns its place.

## Features Reverse-Engineered from Commercial Services

Key capabilities adapted from the commercial landscape:

| Feature | Inspired By | Kotoleaf Adaptation |
|---------|------------|--------------------|
| Context-buffered translation | Flitto (cross-contextual inference) | Configurable buffer per language direction; larger for JA-to-EN |
| Two-stage correction | Flitto (2-stage correction system) | NLLB fast pass + Claude refinement pass |
| Institutional glossary | Flitto (hyper-personalisation), Palabra (glossary API) | Local glossary from Workspace/GitHub/Slack + per-meeting materials |
| QR-code access | Flitto (no-install audience access) | Web app, no install, Google SSO |
| Glossary API for speech | Palabra AI | Whisper init_prompt biasing + translation-layer term enforcement |
| Continuous learning loop | Flitto (post-event log analysis) | Vocab tracking + FSRS feeds back into interleaving decisions |
| Material pre-learning | Flitto (pre-event customisation) | Meeting materials upload + term extraction before session |

The key differentiator that no commercial service offers: **adaptive per-participant interleaving that fades as the participant learns** (the growth system).

## MVP Plan

### Phase 1 -- The Nemawashi MVP

The simplest thing that is useful: two people, one conversation, interleaved understanding.

- Web app with subtitle bar
- 1-to-1 mode only (2 participants)
- faster-whisper ASR + NLLB translation (no two-stage correction yet)
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
- Two-stage correction with Claude Haiku

**Success metric**: a participant who reviews flashcards regularly sees noticeably less interleaving over weeks of meetings, matching their actual comprehension growth.

### Phase 3 -- Institutional Knowledge

The shared root network.

- ChibaTech glossary (manual entry + ingestion from Workspace, GitHub, Slack)
- Meeting materials upload + Gemini-powered term extraction
- Cultural briefing notes from Claude Sonnet
- Misunderstanding detection for culturally-loaded expressions
- Per-meeting session glossary

**Success metric**: an English speaker uploads pitch slides before a meeting with Japanese executives, and domain terms translate consistently throughout the presentation with cultural context surfaced where needed.

### Phase 4 -- Scale Up

From nemawashi to the whole organisation.

- In-person meetings with 3-5 participants (speaker diarization)
- Google Meet bot integration
- Max Interleaf mode for larger calls (6+ participants)
- Data retention controls (vocab only / summary / full transcript / full + audio)
- Code-switching handling for mixed EN-JA sentences

**Success metric**: a 5-person in-person meeting and a 10-person Google Meet call both run smoothly with appropriate interleaving, and all participants' vocabulary databases are updated with new terms from the meeting.
