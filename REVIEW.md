# Design Review — First Principles

## Where the Design Is Strong

**Nemawashi-first is the right forcing function.** Designing for the most intimate, simplest use case (two people, one conversation) is a genuine architectural constraint that prevents premature generalization. If the product doesn't work for two people, adding more people won't help. The MVP plan respects this.

**API-first architecture is pragmatic.** No GPU, no self-hosting, no VRAM budgeting. The server is a stateless orchestration layer. This is the correct decision for a team building a product, not an ML research project. The cost model (~$1-1.50/hr) is defensible for an internal tool.

**The Per-User Filter as a cheap personalization layer is architecturally sound.** Sharing the expensive work (ASR, translation, correction) across all participants and only personalizing at the output filter stage is the right decomposition. This is where the scaling story actually holds up.

**The research is thorough.** 50+ references, including 2025-2026 papers. The code-switching landscape analysis, the FSRS academic grounding, and the commercial competitor reverse-engineering are well done.

**The privacy model is clear and appropriately positioned.** The four-tier retention model with vocab-only as default is sensible. The explicit acknowledgement of the tradeoff (API providers see data, but deliver quality that would take years to build) is honest.

---

## Where the Design Is Weak or Misaligned with Intent

### 1. The Comprehension Model — the load-bearing wall — is a sketch

The entire product thesis is: "we know what you understand, so we show you only what you don't." The system that determines this — the Mind layer's Comprehension Model — gets four bullet points and no concrete specification.

The only concrete mechanism for tracking comprehension is FSRS vocabulary state. But FSRS is a *flashcard scheduling algorithm*, not a comprehension model. It tells you whether someone has *reviewed* a term on a card, not whether they *understood* it in real-time spoken context. The gap between "reviewed this flashcard yesterday" and "understood this word in a fast-paced Japanese sentence with subject omission and keigo" is enormous.

The design acknowledges this is "a relatively novel application" and cites Broccoli (reading context) and incidental learning studies. But reading allows pause and re-reading; live speech does not. Treating each passive encounter as `Rating.Good` will inflate stability for terms the participant never actually learned, which poisons the growth level calculation — the very mechanism that distinguishes this tool from a translator.

**This is the hardest problem in the system and it gets the least design attention.**

### 2. Interleaving — the core differentiator — has no interaction design

The README and DESIGN talk extensively about the *philosophy* of interleaving and the *system* that decides when to interleave, but never describe **what the user actually sees**.

- At Seedling: "full translation with vocabulary annotations, readings, cultural notes." What does this look like? Inline annotations in the subtitle? A sidebar? Tooltips?
- At Canopy: "key terms and idiomatic expressions surfaced." Surfaced how? Highlighted words? A separate panel?
- At Deep Root: "only rare vocabulary or detected misunderstandings break through." Break through into what? An occasional tooltip over an otherwise-unstyled subtitle?
- At Evergreen: "silent unless invoked." How does the user invoke it? A hotkey? Clicking a word? A manual toggle?

You can't suppress individual words from a translated sentence without making it ungrammatical. So what does "reduced interleaving" actually mean in a subtitle bar? Does the subtitle disappear entirely? Does it shift from full translation to original-language-only with selective annotations? Does the UI show the original with a few glosses?

The product thesis depends on this interaction being right, and it is completely unspecified. This needs wireframes or at minimum concrete examples of what each growth level looks like on screen for a given utterance.

### 3. The Tier 1 / Tier 2 translation pipeline has an undefined user experience

The design describes two translation tiers:
- Tier 1: Google Cloud NMT (~50-100ms) for "primary subtitle stream"
- Tier 2: Claude Haiku (~800-1500ms) for "contextual enrichment"

But how do these combine in the user's view? The possibilities are very different:

**Option A**: User sees NMT subtitles immediately, then Claude *corrects* them 1-2 seconds later (subtitle text changes in-place). This is jarring — text shifting under your eyes while you're reading it.

**Option B**: User sees NMT subtitles, and Claude adds *annotations* (glosses, cultural notes) that appear alongside or below after a delay. This is less jarring but adds visual complexity.

**Option C**: Claude only fires for flagged terms (misunderstandings, glossary items) and the NMT subtitle is the primary experience. Claude output is overlaid selectively.

**Option D**: The system waits for both and presents a merged result (~1.5-2s total latency). This is simpler but sacrifices the speed advantage of having NMT at all.

Each option has fundamentally different UX, latency, and architecture implications. The design doesn't choose.

### 4. The "Symmetric" principle obscures real asymmetry

Principle 4 states "English and Japanese are treated as equal." But the actual challenges are deeply asymmetric:

- JA→EN requires word-order buffering, subject inference, keigo register mapping
- EN→JA is grammatically more straightforward but faces katakana/kanji choice issues
- Japanese text uses 2-4x more tokens (cost asymmetry documented in the design itself)
- Japanese has multiple writing systems requiring reading annotations (furigana)
- Code-switching patterns are directional (English loanwords in Japanese speech vs. Japanese terms in English speech follow different patterns)

"Symmetric" is a good *aspiration* but stating it as a design principle implies the engineering can treat both directions identically, which it cannot. A more honest framing: "Both directions receive equal investment and care, through direction-specific handling where the languages demand it."

### 5. The Mind layer asks too much of a single Claude call

The design places enormous responsibility on Claude Haiku calls:
- Glossary-aware correction of NMT output
- Cultural annotations
- Misunderstanding detection
- Interleaving decisions

The system prompt includes: ChibaTech glossary, per-meeting session glossary, participant relationship context, recent conversation history, and register guidance. This is a large prompt doing multi-task reasoning at ~10 calls/minute. Haiku is optimized for speed and cost, not complex multi-objective reasoning. The design should either scope down what each call does, or acknowledge that some of these tasks (especially misunderstanding detection) may need to be separated or batched.

### 6. No feedback loop from user to system during meetings

If the growth level is wrong — if the system thinks you know a word but you don't — there is no mechanism to correct this during a meeting. The user can review flashcards *after* the meeting, but in the moment, they simply miss the context.

A minimal signal — tapping a word to request a gloss, or a "I didn't catch that" button — would both improve the user experience and provide ground truth for the comprehension model (addressing weakness #1). The design mentions engagement signals "(lookups, pauses, correct usage) in later phases" but defers this to an unspecified future.

### 7. No failure modes or graceful degradation

The design doesn't address:
- What happens when Deepgram misrecognizes a code-switched word?
- What happens when speaker diarization assigns a sentence to the wrong person?
- What happens when Claude hallucinates a cultural annotation?
- What happens when network latency spikes and subtitles are 5+ seconds behind?
- What happens when the system is *wrong* about a misunderstanding (false positive)?

For a real-time communication tool, degradation behavior matters as much as happy-path behavior.

---

## Where the Intent Is Vague and Requires Clarification

### A. What is "interleaving" concretely?

This is the most critical ambiguity. The word "interleaving" is used throughout as if its meaning is self-evident, but it could mean:

1. **Full bilingual subtitles** — you see both the original and the translation, with selective annotations
2. **Selective translation** — you see the original language, with translations only for terms you don't know
3. **Annotated translation** — you see a full translation, with certain terms getting extra context (readings, glosses, cultural notes)
4. **Graduated visibility** — the subtitle bar itself fades, shrinks, or becomes less prominent as your level increases

These are four very different products. The design needs to pick one (or describe the progression between them) before implementation.

### B. Who is the actual user persona?

The design describes ChibaTech as bilingual, but doesn't characterize the actual users:
- What's the distribution of proficiency? Mostly intermediate? A few beginners and many advanced?
- Are the meetings primarily one-directional (presentation) or conversational?
- Is the primary pain point vocabulary, pragmatics (indirect communication), or something else entirely?
- Would people actually review flashcards? (This assumption drives the entire growth system.)

The success metric for Phase 1 is "both report that the subtitles helped." This is achievable with a plain translator. The growth system — the thing that makes Kotoleaf different — isn't validated until Phase 2. Is there evidence that ChibaTech employees *want* to learn rather than just be translated for?

### C. What happens at the boundary between growth levels?

The four levels are poetically described but the transitions are undefined:
- What's the threshold for Seedling → Canopy? Is it 20% rooted vocabulary? 40%?
- Against what vocabulary universe? All Japanese words? All words encountered in meetings?
- Does the level change mid-meeting or only between meetings?
- Can the level go backwards (e.g., after a long break without review)?
- What happens when a Canopy-level user enters a meeting on a topic they know nothing about (their general level is high but domain vocabulary is zero)?

The formula — `rooted_vocab / total_vocab_encountered, weighted by FSRS state and term frequency` — is a sketch. The denominator (total vocab encountered) will grow monotonically with every meeting, so the ratio will trend downward unless reviews keep pace, which creates a treadmill effect that contradicts the "roots grow" metaphor.

### D. Tech stack decisions that affect architecture

These unresolved choices have architectural consequences:

| Decision | Implications |
|----------|-------------|
| SvelteKit vs React | Different component models, different SSR behavior |
| LiveKit vs raw WebSocket | LiveKit gives you room management, audio transport, and agent framework for free; raw WS means building all of it |
| Firestore vs Supabase | Firestore is document-oriented (awkward for FSRS relational queries); Postgres is relational (natural for SRS). The design itself notes this tension |
| Cloud Run vs Fly.io | Cloud Run has a 60-min WebSocket timeout requiring reconnection logic; Fly.io doesn't |

The LiveKit vs raw WebSocket choice especially matters: the LiveKit `live-translated-captioning` example cited in the design is essentially Kotoleaf Phase 1 without the growth system. Adopting LiveKit would short-circuit significant audio transport engineering but lock the architecture to their abstractions.

### E. How does Max Interleaf mode relate to the growth system?

For 6+ participant calls, everyone sees "full translation regardless of their level." But the system still tracks vocabulary. Does this mean:
- Terms encountered in Max Interleaf mode are treated as `Rating.Good` even though the user had full translation support?
- Or are they tracked but not scheduled (since the user didn't demonstrate comprehension)?

If the former, Max Interleaf meetings inflate vocabulary scores. If the latter, frequent large-meeting attendees may never progress because their encounters don't count.

---

## Recommendations

1. **Design the interleaving UI before writing code.** Mock up what each growth level looks like for a concrete utterance. This will force resolution of the most critical ambiguity in the design.

2. **Specify the Tier 1 / Tier 2 interaction model.** Pick one of the options (A-D above) and design around it. This determines the latency budget, the UI update pattern, and the Claude prompt design.

3. **Build a minimal comprehension model for Phase 1** rather than deferring it entirely. Even a simple signal — "user tapped this word for a gloss" — provides ground truth that FSRS alone cannot.

4. **Commit to tech stack choices.** The "or" decisions should be resolved. Based on what's in the design, LiveKit + Supabase/Postgres + SvelteKit + Cloud Run (with reconnection logic) is the natural fit.

5. **Define growth level thresholds concretely**, even if the initial values are wrong. They can be tuned later, but the system needs numbers to implement.

6. **Rename Principle 4** from "Symmetric" to something like "Equal investment, direction-aware handling" to avoid implying the engineering is identical.
