import assert from "node:assert/strict";
import { test } from "node:test";
import { hintReceipt } from "../src/hint-receipt.ts";

test("receipt is a bounded supplied-term observation, not a transcript copy", () => {
	assert.deepEqual(hintReceipt("request", 1, 2, ["紅葉ラボ", "absent", "紅葉ラボ", ""], "今日は紅葉ラボです"), {
		id: "request", started: 1, completed: 2,
		terms: [{ term: "紅葉ラボ", appeared: true }, { term: "absent", appeared: false }],
	});
});

test("literal NFC substring semantics are explicit; no case folding or fuzzy matching", () => {
	const receipt = hintReceipt("request", 1, 2, ["café", "API", "cat", "紅葉 ラボ"], "cafe\u0301 api concatenate 紅葉ラボ");
	assert.deepEqual(receipt.terms.map(t => t.appeared), [true, false, true, false]);
});

test("empty text and no hints remain valid observations", () => {
	assert.deepEqual(hintReceipt("request", 1, 2, [], "private text").terms, []);
	assert.deepEqual(hintReceipt("request", 1, 2, ["紅葉ラボ"], "").terms, [{ term: "紅葉ラボ", appeared: false }]);
});
