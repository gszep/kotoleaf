// Deepgram query construction shared by every route. Kotoleaf only serves
// English/Japanese code-switching, so language selection is fixed here and
// whatever the client asked for is replaced.

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

// Most frequent per-word language in a Deepgram alternative, for compact listings.
export function dominantLanguage(words: Array<{ language?: string }> | undefined): string | undefined {
	const counts = new Map<string, number>();
	for (const word of words ?? []) {
		if (word.language) counts.set(word.language, (counts.get(word.language) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 0;
	for (const [language, count] of counts) {
		if (count > bestCount) [best, bestCount] = [language, count];
	}
	return best;
}
