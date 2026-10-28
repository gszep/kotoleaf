import assert from "node:assert/strict";
import { test } from "node:test";
import { deepgramQuery, dominantLanguage, MAX_KEYTERMS, parseGlossary } from "../src/params.ts";

test("forces nova-3 EN/JA code-switching and keeps audio parameters", () => {
	const client = new URLSearchParams("model=nova-2&language=en&detect_language=true&encoding=linear16&sample_rate=16000&channels=2&multichannel=true&diarize=true");
	const q = deepgramQuery(client, [], "live");
	assert.equal(q.get("model"), "nova-3");
	assert.equal(q.get("language"), "multi");
	assert.deepEqual(q.getAll("language_hint"), ["en", "ja"]);
	assert.equal(q.has("detect_language"), false);
	assert.equal(q.get("encoding"), "linear16");
	assert.equal(q.get("channels"), "2");
	assert.equal(q.get("diarize"), "true");
	assert.equal(q.get("endpointing"), "100");
});

test("batch keeps client endpointing absent and smart_format default", () => {
	const q = deepgramQuery(new URLSearchParams(), [], "batch");
	assert.equal(q.has("endpointing"), false);
	assert.equal(q.get("smart_format"), "true");
});

test("merges glossary and client keyterms without duplicates, capped", () => {
	const glossary = Array.from({ length: MAX_KEYTERMS + 5 }, (_, i) => `term${i}`);
	const q = deepgramQuery(new URLSearchParams("keyterm=Kotoleaf&keyterm=term0"), ["Kotoleaf", ...glossary], "live");
	const terms = q.getAll("keyterm");
	assert.equal(terms.length, MAX_KEYTERMS);
	assert.equal(terms[0], "Kotoleaf");
	assert.equal(new Set(terms).size, terms.length);
});

test("glossary parsing ignores comments and blanks", () => {
	assert.deepEqual(parseGlossary("# c\nKotoleaf\n\n千葉工業大学 # school\n"), ["Kotoleaf", "千葉工業大学"]);
});

test("dominant language", () => {
	assert.equal(dominantLanguage([{ language: "ja" }, { language: "en" }, { language: "ja" }]), "ja");
	assert.equal(dominantLanguage([]), undefined);
});

import { archiveCutoff, nextArchiveTime } from "../src/schedule.ts";

test("archive runs next Sunday 03:00 JST", () => {
	const wednesday = Date.UTC(2026, 9, 28, 9, 0); // Wed 28 Oct 2026 18:00 JST
	assert.equal(new Date(nextArchiveTime(wednesday)).toISOString(), "2026-10-31T18:00:00.000Z");
	const justAfter = Date.UTC(2026, 9, 31, 18, 0, 1);
	assert.equal(new Date(nextArchiveTime(justAfter)).toISOString(), "2026-11-07T18:00:00.000Z");
	const saturdayMorning = Date.UTC(2026, 9, 31, 1, 0);
	assert.equal(new Date(nextArchiveTime(saturdayMorning)).toISOString(), "2026-10-31T18:00:00.000Z");
	assert.equal(archiveCutoff(8 * 86_400_000, 7), 86_400_000);
});

test("store is a worker-only option and is not forwarded", () => {
	const q = deepgramQuery(new URLSearchParams("store=false&encoding=linear16"), [], "live");
	assert.equal(q.has("store"), false);
	assert.equal(q.get("encoding"), "linear16");
});
