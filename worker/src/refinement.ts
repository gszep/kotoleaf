import type { Line } from "./store";
import type { Correction } from "./learning";

export interface Citation { seq: number; quote: string }
export interface Cleaned { sources: number[]; text: string; change: "formatting" | "wording" }
export interface Note { kind: "discussion" | "decision" | "action" | "question"; en: string; ja: string; evidence: Citation[] }
export interface Term { term: string; reading: string; meaning: string; evidence: Citation[] }
export interface Refinement { cleaned: Cleaned[]; notes: Note[]; terms: Term[] }
export function refinementConfigured(env: Env): boolean {
 return Boolean(env.REFINEMENT_URL && env.REFINEMENT_TOKEN && env.REFINEMENT_MODEL);
}
export const CONTRACT = `Return ONLY JSON, no markdown, with:
{"cleaned":[{"sources":[1],"text":"..."}],"notes":[{"kind":"discussion|decision|action|question","en":"...","ja":"...","evidence":[{"seq":1,"quote":"exact raw excerpt"}]}],"terms":[{"term":"...","reading":"...","meaning":"...","evidence":[{"seq":1,"quote":"exact raw excerpt"}]}]}.
cleaned covers EVERY input line in lines once, in order. previous_source_context is
read-only earlier context, not new output and not eligible as a citation. Repair punctuation and false sentence
breaks using surrounding context. You may join consecutive lines only with the same
speaker AND channel, never when speaker is null (unknown/mixed). Keep all spoken
words, repetitions, hesitation and uncertainty; only propose a spelling correction
when context supports it. Never invent missing words. Notes are short bilingual
drafts: separate decisions, actual commitments, questions and discussion. Cite exact
raw excerpts for EVERY note and learning term, not paraphrases. Omit unsupported
claims. Empty notes/terms are valid. No more than 8 notes and 8 terms. Terms are
learning/clarification candidates, prioritizing Japanese; use an empty reading for
a name with no known reading rather than inventing one. Never invent budget or
project details in notes or translations. Terms are not automatically saved flashcards.`;

function text(x: unknown, max: number): string {
 if (typeof x !== "string" || !x.trim() || x.length > max) throw new Error("invalid refinement text");
 return x.trim();
}
// Deliberately conservative: unlike stripping all punctuation this preserves
// numbers, apostrophes, hyphens and symbols; even formatting remains a draft.
export function words(s: string): string {
	return (s.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+(?:['’.,-][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}\s.,!?。、「」『』！？:;]/gu) ?? []).join("\u0001");
}
export function validateRefinement(value: any, lines: Line[]): Refinement {
 if (!Array.isArray(value?.cleaned) || !Array.isArray(value?.notes) || !Array.isArray(value?.terms)
   || value.cleaned.length > lines.length || value.notes.length > 8 || value.terms.length > 8) throw new Error("invalid refinement shape");
 const bySeq = new Map(lines.map(l => [l.seq, l]));
 const used: number[] = [];
 const cleaned = value.cleaned.map((c: any): Cleaned => {
  if (!Array.isArray(c.sources) || !c.sources.length) throw new Error("missing sources");
  const source: Line[] = c.sources.map((s: number) => { const l = bySeq.get(s); if (!l) throw new Error("unknown source"); return l; });
  if (source.length > 1 && (source[0].speaker === null || source[0].channel === null || source.some(l => l.speaker !== source[0].speaker || l.channel !== source[0].channel))) throw new Error("speaker merge");
  used.push(...c.sources);
  const result = text(c.text, 16000);
  return { sources: c.sources, text: result, change: words(result) === words(source.map(l => l.text).join(" ")) ? "formatting" : "wording" };
 });
 if (JSON.stringify(used) !== JSON.stringify(lines.map(l => l.seq))) throw new Error("source omission or reorder");
 const citations = (input: any): Citation[] => {
  if (!Array.isArray(input) || !input.length || input.length > 8) throw new Error("missing evidence");
  return input.map(c => {
   const quote = text(c.quote, 2000), line = bySeq.get(c.seq);
   if (!line || !line.text.includes(quote)) throw new Error("ungrounded citation");
   return { seq: c.seq, quote };
  });
 };
 const notes = value.notes.map((n: any): Note => {
  if (!["discussion", "decision", "action", "question"].includes(n.kind)) throw new Error("invalid note kind");
  return { kind: n.kind, en: text(n.en, 2000), ja: text(n.ja, 2000), evidence: citations(n.evidence) };
 });
 const terms = value.terms.map((t: any): Term => ({term: text(t.term, 100), reading: t.reading === "" ? "" : text(t.reading, 200), meaning: text(t.meaning, 1000), evidence: citations(t.evidence)}));
 return { cleaned, notes, terms };
}

export function contextPayload(lines: Line[], corrections: Correction[], context: string) {
 return { context, confirmed_vocabulary: corrections.filter(c => c.active).map(({original,term,reading,meaning}) => ({original,term,reading,meaning})), lines };
}

export async function generateRefinement(env: Env, system: string, payload: unknown): Promise<{result: Refinement; model: string; elapsed_ms: number}> {
 if (!refinementConfigured(env)) throw new Error("refinement not configured");
 const started = Date.now();
 const response = await fetch(env.REFINEMENT_URL!, {method:"POST", redirect:"manual", headers:{Authorization:`Bearer ${env.REFINEMENT_TOKEN}`,"Content-Type":"application/json"},
  body:JSON.stringify({model:env.REFINEMENT_MODEL,max_tokens:6000,system:system + "\n\n" + CONTRACT,messages:[{role:"user",content:JSON.stringify(payload)}]}),signal:AbortSignal.timeout(45000)});
 if (!response.ok) throw new Error(`refinement upstream HTTP ${response.status}`);
 const body: any = await response.json();
 if (body.stop_reason !== "end_turn") throw new Error("incomplete refinement");
 const raw = (body.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
 const result = validateRefinement(JSON.parse(raw), (payload as {lines:Line[]}).lines);
 return {result,model:String(body.model ?? env.REFINEMENT_MODEL),elapsed_ms:Date.now()-started};
}
