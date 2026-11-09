import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCapacity, correctionInput, uuid, type Correction } from "../src/learning.ts";
import { deepgramQuery } from "../src/params.ts";

const input = { id: "b59ab753-893c-428b-8075-88a35bc8b010", confirmed: true, original: "光洋ラボ", term: "紅葉ラボ", reading: "こうようラボ", meaning: "Koyo Lab — fictional" };
test("confirmation is explicit, Unicode retained and canonically normalized", () => {
	assert.equal(correctionInput(input).term, "紅葉ラボ");
	assert.equal(correctionInput({ ...input, term: " cafe\u0301 " }).term, "café");
	assert.throws(() => correctionInput({ ...input, confirmed: false }));
	assert.throws(() => correctionInput(null));
	assert.throws(() => correctionInput({ ...input, term: "  " }));
	assert.throws(() => correctionInput({ ...input, term: "語".repeat(17) }));
	assert.throws(() => correctionInput({ ...input, term: "name\u202e" }));
	assert.throws(() => correctionInput({ ...input, meaning: { x: 1 } }));
	assert.throws(() => correctionInput({ ...input, reading: "a\nb" }));
	assert.throws(() => uuid("../other"));
});
test("hint capacity is bounded in UTF-8 and duplicates rejected", () => {
	const c = correctionInput(input);
	assert.doesNotThrow(() => checkCapacity([], c));
	assert.throws(() => checkCapacity([{ ...c } as Correction], c));
	assert.throws(() => checkCapacity(Array.from({ length: 16 }, (_, n) => ({ term: String(n) } as Correction)), c));
	assert.throws(() => checkCapacity(Array.from({ length: 5 }, () => ({ term: "語".repeat(16) } as Correction)), c));
});
test("confirmed bilingual terms are hints only; client cannot undo usage redaction", () => {
	const query = deepgramQuery(new URLSearchParams("redact_usage=false&model=other&language=en"), ["紅葉ラボ", "café"], "live");
	assert.deepEqual(query.getAll("keyterm"), ["紅葉ラボ", "café"]);
	assert.equal(query.get("redact_usage"), "true");
	assert.equal(query.get("model"), "nova-3");
	assert.equal(query.get("language"), "multi");
});
