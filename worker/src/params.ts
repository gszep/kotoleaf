// Shared EN/JA-preferred multilingual query. Hints are not language restrictions;
// client model/language choices are replaced by this gateway's existing policy.

export const LANGUAGE_HINTS = ["en", "ja"] as const;
export const MODEL = "nova-3";
// Deepgram documents up to 100 keyterms (500 tokens) per request.
export const MAX_KEYTERMS = 100;

const OVERRIDDEN = new Set([
	"model",
	"language",
	"language_hint",
	"detect_language",
	"keywords",
	"keyterm",
	"version",
	// Worker-only option, never forwarded to Deepgram.
	"store",
	// Names/hints must not be copied into Deepgram usage records.
	"redact_usage",
]);

export type Mode = "live" | "batch";

export function parseGlossary(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/#.*$/, "").trim())
		.filter(Boolean);
}

export function deepgramQuery(client: URLSearchParams, glossary: string[], mode: Mode): URLSearchParams {
	const out = new URLSearchParams();
	client.forEach((value, key) => {
		if (!OVERRIDDEN.has(key)) out.append(key, value);
	});

	out.set("model", MODEL);
	out.set("language", "multi");
	out.set("redact_usage", "true");
	for (const hint of LANGUAGE_HINTS) out.append("language_hint", hint);

	const terms: string[] = [];
	for (const term of [...glossary, ...client.getAll("keyterm")]) {
		if (term && !terms.includes(term)) terms.push(term);
	}
	for (const term of terms.slice(0, MAX_KEYTERMS)) out.append("keyterm", term);

	if (!out.has("smart_format")) out.set("smart_format", "true");
	if (!out.has("punctuate")) out.set("punctuate", "true");
	// Deepgram recommends 100 ms endpointing for streaming code-switching.
	if (mode === "live" && !out.has("endpointing")) out.set("endpointing", "100");
	return out;
}

// Derived listing labels only. First occurrence wins a final-count tie.
export function mostFrequent<T>(values: Iterable<T>): T | undefined {
	const counts = new Map<T, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best: T | undefined;
	let bestCount = 0;
	for (const [value, count] of counts) {
		if (count > bestCount) [best, bestCount] = [value, count];
	}
	return best;
}

export function dominantLanguage(words: Array<{ language?: string }> | undefined): string | undefined {
	return mostFrequent((words ?? []).map(word => word.language).filter((value): value is string => Boolean(value)));
}
