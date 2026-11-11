// Local end-to-end check: runs `wrangler dev` against a mock Deepgram server and
// exercises every route. No real credentials or audio are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const MOCK_PORT = 18787;
const WORKER_PORT = 18788;
const TOKEN = "local-test-token";
const seen = [];
let failNextBatch = false;
let nextTranscript = null;
let holdNextBatch = null;

const words = [
	{ word: "今日", start: 0.1, end: 0.4, speaker: 1, language: "ja" },
	{ word: "は", start: 0.4, end: 0.5, speaker: 1, language: "ja" },
	{ word: "meeting", start: 0.5, end: 0.9, speaker: 1, language: "en" },
];
const result = (isFinal, transcript, w) => ({
	type: "Results",
	channel_index: [0, 1],
	start: 0,
	duration: 1.5,
	is_final: isFinal,
	channel: { alternatives: [{ transcript, confidence: 0.9, words: w, languages: ["ja", "en"] }] },
});

const mock = createServer((req, res) => {
	const call = { url: req.url, auth: req.headers.authorization, method: req.method, contentType: req.headers["content-type"], privateHeader: req.headers["x-client-private"], body: [] };
	seen.push(call);
	req.on("data", chunk => call.body.push(chunk));
	req.on("end", async () => {
		call.body = Buffer.concat(call.body);
		if (holdNextBatch) { const hold = holdNextBatch; holdNextBatch = null; await hold(); }
		if (failNextBatch) { failNextBatch = false; res.writeHead(503); res.end("synthetic upstream unavailable"); return; }
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: nextTranscript ?? "今日は meeting", words }] }] } }));
		nextTranscript = null;
	});
});
const wss = new WebSocketServer({ server: mock });
wss.on("connection", (socket, req) => {
	seen.push({ url: req.url, auth: req.headers.authorization, method: req.method, privateHeader: req.headers["x-client-private"], ws: true });
	socket.on("message", (_data, isBinary) => {
		if (!isBinary && String(_data) === "simulate-upstream-failure") { socket.close(1011, "synthetic upstream failure"); return; }
		if (!isBinary) return;
		socket.send(JSON.stringify(result(false, "今日", words.slice(0, 1))));
		socket.send(JSON.stringify(result(true, "今日は meeting", words)));
	});
});
await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));

const dir = mkdtempSync(join(tmpdir(), "kotoleaf-e2e-"));
writeFileSync(".dev.vars", `DEEPGRAM_API_KEY=mock-deepgram-key\nACCESS_TOKENS=local:${TOKEN},other:local-other-token\nOPENCODE_CHAT_TOKEN=local-chat-only-token\n`, { flag: "wx", mode: 0o600 });
let log = "";
function startWorker() {
	const child = spawn(process.execPath,
		["node_modules/wrangler/bin/wrangler.js", "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", dir, "--var", `DEEPGRAM_URL:http://127.0.0.1:${MOCK_PORT}/v1/listen`, "--var", "HOT_DAYS:0"],
		{ stdio: ["ignore", "pipe", "pipe"] });
	child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
	return child;
}
let wrangler = startWorker();
async function stopWorker() {
	if (wrangler.exitCode !== null) return;
	await new Promise(resolve => { wrangler.once("exit", resolve); wrangler.kill("SIGTERM"); });
}

// Fault injection is restricted to this run's synthetic DB, with workerd stopped.
function receiptSql(sql) {
	for (const file of readdirSync(dir, { recursive: true }).filter(file => file.endsWith(".sqlite"))) {
		const db = new DatabaseSync(join(dir, file));
		try {
			if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'hint_receipts'").get()) { db.exec(sql); return; }
		} finally { db.close(); }
	}
	throw new Error("Synthetic receipt database not found");
}

const base = `http://127.0.0.1:${WORKER_PORT}`;
const auth = { Authorization: `Bearer ${TOKEN}` };
async function ready() {
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {}
		if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`);
		await new Promise((r) => setTimeout(r, 500));
	}
}
try {
	await ready();

	console.log("worker up");
	assert.equal((await fetch(`${base}/learn?demo=1`)).status, 200);
	assert.match(await (await fetch(`${base}/learn.js`)).text(), /synthetic-learning-v1/);
	assert.equal((await fetch(`${base}/learning`)).status, 401);
	for (const authorization of ["", "Bearer wrong", "Bearer local-test-tokex", "Basic local-test-token"]) {
		assert.equal((await fetch(`${base}/learning`, { headers: { Authorization: authorization } })).status, 401, "invalid credential rejected");
	}
	for (const authorization of [`Bearer ${TOKEN}`, `Token ${TOKEN}`, `bEaReR   ${TOKEN}`, TOKEN]) {
		assert.equal((await fetch(`${base}/learning`, { headers: { Authorization: authorization } })).status, 200, "existing credential syntax preserved");
	}
	const learn = async (path = "", method = "GET", body, headers = auth) => fetch(`${base}/learning${path}`, { method, headers: { ...headers, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
	const correction = { id: crypto.randomUUID(), original: "光洋ラボ", term: "紅葉ラボ", reading: "こうようラボ", meaning: "Koyo Lab — fictional", confirmed: true };
	assert.equal((await learn("", "POST", { ...correction, confirmed: false })).status, 400);
	assert.equal((await learn("", "POST", correction)).status, 201);
	assert.equal((await learn("", "POST", correction)).status, 200, "lost-response retry is idempotent");
	assert.equal((await learn("", "POST", { ...correction, term: "other" })).status, 409, "id cannot be reused for a different correction");
	assert.equal((await learn("", "POST", { ...correction, id: crypto.randomUUID() })).status, 409, "duplicate active spelling rejected");
	const otherAuth = { Authorization: "Bearer local-other-token" };
	assert.deepEqual((await (await learn("", "GET", undefined, otherAuth)).json()).corrections, [], "learning is isolated by token label");
	assert.equal((await learn("/" + correction.id, "PATCH", { active: false }, otherAuth)).status, 404);
	assert.equal((await learn("", "GET", undefined, { Authorization: "Bearer local-chat-only-token" })).status, 401, "chat token cannot read learning");
	assert.equal((await learn("", "POST", correction, { Authorization: "Bearer local-chat-only-token" })).status, 401, "chat token cannot write learning");
	assert.equal((await fetch(`${base}/learning`, { method: "POST", headers: auth, body: "{" })).status, 400);
	assert.equal((await learn("", "POST", { ...correction, meaning: "x".repeat(5000) })).status, 413);
	const review = { id: crypto.randomUUID(), rating: "again" };
	assert.equal((await learn(`/${correction.id}/reviews`, "POST", review)).status, 201);
	assert.equal((await learn(`/${correction.id}/reviews`, "POST", review)).status, 200);
	assert.equal((await learn(`/${correction.id}/reviews`, "POST", { ...review, rating: "known" })).status, 409);
	// Kill the actual local runtime, then reopen the same SQLite persistence.
	await stopWorker(); wrangler = startWorker(); await ready();
	const restored = await (await learn()).json();
	assert.equal(restored.corrections.length, 1);
	assert.equal(restored.corrections[0].original, correction.original);
	assert.equal(restored.corrections[0].reviews, 1, "review survives restart without duplicate retry");
	assert.equal(restored.corrections[0].last_rating, "again");
	assert.deepEqual(restored.keyterms, [correction.term]);
	assert.equal(restored.last_hint_receipt, null, "no invented/backfilled receipt");
	assert.equal((await fetch(`${base}/meetings`)).status, 401, "unauthenticated request rejected");
	const chatAuth = { Authorization: "Bearer local-chat-only-token" };
	assert.equal((await fetch(`${base}/meetings`, { headers: chatAuth })).status, 401, "chat token cannot read meeting content");
	assert.equal((await fetch(`${base}/v1/listen`, { method: "POST", headers: chatAuth, body: "blocked" })).status, 401, "chat token cannot use other speech routes");
	assert.equal((await fetch(`${base}/archive/run`, { method: "POST", headers: chatAuth })).status, 401, "chat token cannot change retention");
	const callsBeforeChat = seen.length;
	assert.equal((await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: chatAuth, body: new FormData() })).status, 400, "chat token authenticates without sending audio upstream");
	assert.equal(seen.length, callsBeforeChat);
	const chatForm = new FormData();
	chatForm.append("file", new Blob([new Uint8Array(64)], { type: "audio/ogg;codecs=opus" }), "voice.ogg");
	const chatResult = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: chatAuth, body: chatForm });
	assert.equal(chatResult.status, 200);
	assert.equal(chatResult.headers.get("x-kotoleaf-hint-receipt"), "not-recorded", "chat-only dictation retains no receipt");
	assert.equal((await chatResult.json()).text, "今日は meeting");
	assert.equal(seen.at(-1).method, "POST");
	assert.equal(seen.at(-1).contentType, "audio/ogg;codecs=opus");
	assert.deepEqual(seen.at(-1).body, Buffer.alloc(64), "OpenAI adapter streams file bytes, not multipart framing");
	assert.ok(!new URL(seen.at(-1).url, "http://x").searchParams.getAll("keyterm").includes(correction.term), "chat transcription does not inherit another label's names");

	// OpenAI-compatible dictation route.
	const form = new FormData();
	form.append("file", new Blob([new Uint8Array(64)], { type: "audio/wav" }), "audio.wav");
	form.append("model", "whisper-1");
	form.append("language", "en");
	const openai = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: { ...auth, "X-Client-Private": "synthetic-client-only" }, body: form });
	assert.equal(openai.status, 200, await openai.clone().text());
	assert.deepEqual(await openai.json(), { text: "今日は meeting", language: "ja" });
	assert.equal(openai.headers.get("x-kotoleaf-hint-receipt"), "saved");
	assert.equal(openai.headers.get("cache-control"), "no-store");
	const firstReceipt = (await (await learn()).json()).last_hint_receipt;
	assert.deepEqual(firstReceipt.terms, [{ term: correction.term, appeared: false }]);
	assert.ok(firstReceipt.started <= firstReceipt.completed);
	assert.deepEqual(Object.keys(firstReceipt).sort(), ["completed", "id", "started", "terms"], "no transcript/audio retained in receipt");
	assert.equal((await (await learn("", "GET", undefined, otherAuth)).json()).last_hint_receipt, null, "receipt is label isolated");
	const dictation = new URL(seen.at(-1).url, "http://x").searchParams;
	assert.equal(dictation.get("model"), "nova-3");
	assert.equal(dictation.get("language"), "multi");
	assert.deepEqual(dictation.getAll("language_hint"), ["en", "ja"]);
	assert.ok(dictation.getAll("keyterm").includes("Kotoleaf"));
	assert.ok(dictation.getAll("keyterm").includes(correction.term), "saved correction reapplied after runtime restart");
	assert.equal(dictation.get("redact_usage"), "true");
	assert.equal(seen.at(-1).auth, "Token mock-deepgram-key", "worker substitutes the Deepgram key");
	assert.equal(seen.at(-1).privateHeader, undefined);
	assert.equal(seen.at(-1).contentType, "audio/wav");
	nextTranscript = `今日は${correction.term}です。`;
	const matched = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	assert.equal((await matched.json()).text, `今日は${correction.term}です。`, "original provider text stays unchanged");
	let matchedReceipt = (await (await learn()).json()).last_hint_receipt;
	assert.deepEqual(matchedReceipt.terms, [{ term: correction.term, appeared: true }]);
	assert.notEqual(matchedReceipt.id, firstReceipt.id, "latest successful dictation replaces, not appends");
	failNextBatch = true;
	const openaiFailure = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	assert.equal(openaiFailure.status, 503);
	assert.deepEqual(await openaiFailure.json(), { error: { message: "synthetic upstream unavailable" } });
	assert.deepEqual((await (await learn()).json()).last_hint_receipt, matchedReceipt, "failure does not masquerade as a successful receipt");

	// Deepgram-compatible pre-recorded route.
	const batch = await fetch(`${base}/v1/listen?model=nova-2&language=en&detect_language=en&diarize=true`, {
		method: "POST",
		headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "audio/wav", "X-Client-Private": "synthetic-client-only" },
		body: new Uint8Array([0, 127, 128, 255]),
	});
	assert.equal(batch.status, 200);
	const batchQuery = new URL(seen.at(-1).url, "http://x").searchParams;
	assert.equal(batchQuery.get("language"), "multi");
	assert.equal(batchQuery.has("detect_language"), false);
	assert.equal(batchQuery.get("diarize"), "true");
	assert.ok(batchQuery.getAll("keyterm").includes(correction.term));
	assert.equal(seen.at(-1).method, "POST");
	assert.equal(seen.at(-1).auth, "Token mock-deepgram-key");
	assert.equal(seen.at(-1).privateHeader, undefined);
	assert.equal(seen.at(-1).contentType, "audio/wav");
	assert.deepEqual(seen.at(-1).body, Buffer.from([0, 127, 128, 255]), "Deepgram adapter preserves raw bytes");
	failNextBatch = true;
	assert.equal((await fetch(`${base}/v1/listen`, { method: "POST", headers: auth, body: "synthetic" })).status, 503);
	assert.deepEqual((await (await learn()).json()).keyterms, [correction.term], "upstream failure never loses saved learning");

	console.log("http routes ok");
	// Deepgram-compatible live route: relay plus storage of non-interim messages.
	const socket = new WebSocket(`ws://127.0.0.1:${WORKER_PORT}/v1/listen?encoding=linear16&sample_rate=16000&channels=2&multichannel=true`, {
		headers: { Authorization: `Token ${TOKEN}`, "X-Client-Private": "synthetic-client-only" },
	});
	const received = [];
	await new Promise((resolve, reject) => {
		socket.on("open", () => socket.send(new Uint8Array(320)));
		socket.on("message", (data) => {
			received.push(JSON.parse(String(data)));
			if (received.length === 2) resolve();
		});
		socket.on("error", reject);
		socket.on("unexpected-response", (_req, res) => reject(new Error(`upgrade failed ${res.statusCode}`)));
		setTimeout(() => reject(new Error(`live timeout; received=${received.length}; mock saw ws=${seen.some((s) => s.ws)}\n${log.slice(-3000)}`)), 15000);
	});
	socket.close(1000);
	await new Promise((r) => setTimeout(r, 1000));
	console.log("live ok");
	assert.equal(received[0].is_final, false, "interim results reach the client");
	const liveQuery = new URL(seen.find((s) => s.ws).url, "http://x").searchParams;
	assert.equal(liveQuery.get("endpointing"), "100");
	assert.equal(liveQuery.get("channels"), "2");
	assert.ok(liveQuery.getAll("keyterm").includes(correction.term));
	assert.equal(seen.find(s => s.ws).method, "GET");
	assert.equal(seen.find(s => s.ws).auth, "Token mock-deepgram-key");
	assert.equal(seen.find(s => s.ws).privateHeader, undefined);

	const transcript = await (await fetch(`${base}/meetings/latest/transcript`, { headers: auth })).text();
	assert.match(transcript, /\[00:00\] ch0 S1 en\+ja: 今日は meeting/);
	assert.match(transcript, /next_since: 1/);
	assert.match(transcript, /\(ended\)/);
	const raw = await (await fetch(`${base}/meetings/latest/raw`, { headers: auth })).text();
	assert.equal(raw.split("\n").length, 1, "interim result not stored");
	assert.match(raw, /"is_final":true/);
	assert.match(await (await fetch(`${base}/meetings/latest/transcript?since=1`, { headers: auth })).text(), /no new lines/);

	// Transient stream: store=false relays results but persists nothing and is not forwarded.
	const before = (await (await fetch(`${base}/meetings`, { headers: auth })).json()).length;
	const transient = new WebSocket(`ws://127.0.0.1:${WORKER_PORT}/v1/listen?encoding=linear16&sample_rate=16000&store=false`, { headers: { Authorization: `Token ${TOKEN}` } });
	let transientHeader;
	transient.on("upgrade", (res) => (transientHeader = res.headers["x-kotoleaf-meeting"]));
	await new Promise((resolve, reject) => {
		let n = 0;
		transient.on("open", () => transient.send(new Uint8Array(320)));
		transient.on("message", () => ++n === 2 && resolve());
		transient.on("error", reject);
	});
	transient.close(1000);
	await new Promise((r) => setTimeout(r, 1000));
	assert.equal(transientHeader, undefined);
	assert.equal(new URL(seen.filter((s) => s.ws).at(-1).url, "http://x").searchParams.has("store"), false);
	assert.equal((await (await fetch(`${base}/meetings`, { headers: auth })).json()).length, before, "store=false creates no meeting");
	assert.ok(new URL(seen.filter(s => s.ws).at(-1).url, "http://x").searchParams.getAll("keyterm").includes(correction.term), "reconnected transient stream loads confirmed hints");
	const failedSocket = new WebSocket(`ws://127.0.0.1:${WORKER_PORT}/v1/listen?store=false`, { headers: auth });
	await new Promise((resolve, reject) => {
		failedSocket.on("open", () => failedSocket.send("simulate-upstream-failure"));
		failedSocket.on("close", code => { try { assert.equal(code, 1011); resolve(); } catch (e) { reject(e); } });
		failedSocket.on("error", reject);
	});
	assert.deepEqual((await (await learn()).json()).keyterms, [correction.term]);
	assert.equal((await learn(`/${correction.id}/reviews`, "POST", { id: crypto.randomUUID(), rating: "known" })).status, 201);
	let releaseBatch, enteredBatch;
	const entered = new Promise(resolve => { enteredBatch = resolve; });
	holdNextBatch = () => { enteredBatch(); return new Promise(resolve => { releaseBatch = resolve; }); };
	nextTranscript = correction.term;
	const inFlight = fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	await entered;
	assert.equal((await learn(`/${correction.id}`, "PATCH", { active: false })).status, 200);
	assert.deepEqual((await (await learn()).json()).last_hint_receipt, matchedReceipt, "undo preserves the existing receipt");
	releaseBatch();
	assert.equal((await (await inFlight).json()).text, correction.term);
	matchedReceipt = (await (await learn()).json()).last_hint_receipt;
	assert.deepEqual(matchedReceipt.terms, [{ term: correction.term, appeared: true }], "in-flight receipt uses sent snapshot even after undo");
	assert.equal((await learn(`/${correction.id}`, "PATCH", { active: false })).status, 200, "undo retries are safe");
	// A delayed retry of the original save must never resurrect a retracted hint.
	assert.equal((await learn("", "POST", correction)).status, 200);
	assert.deepEqual((await (await learn()).json()).keyterms, []);
	assert.deepEqual((await (await learn()).json()).last_hint_receipt, matchedReceipt, "undo and batch/live requests never rewrite the past dictation snapshot");
	assert.equal((await learn(`/${correction.id}/reviews`, "POST", { id: crypto.randomUUID(), rating: "known" })).status, 404);
	await fetch(`${base}/v1/listen`, { method: "POST", headers: auth, body: "synthetic" });
	assert.ok(!new URL(seen.at(-1).url, "http://x").searchParams.getAll("keyterm").includes(correction.term), "undo removes next-request hint");
	const reconnected = new WebSocket(`ws://127.0.0.1:${WORKER_PORT}/v1/listen?store=false`, { headers: auth });
	await new Promise((resolve, reject) => {
		reconnected.on("open", () => reconnected.send("simulate-upstream-failure"));
		reconnected.on("close", resolve); reconnected.on("error", reject);
	});
	assert.ok(!new URL(seen.filter(s => s.ws).at(-1).url, "http://x").searchParams.getAll("keyterm").includes(correction.term), "reconnect after failure loads undo, not stale hints");
	assert.equal(await (await fetch(`${base}/meetings/latest/raw`, { headers: auth })).text(), raw, "confirmation, review and undo never replace raw transcripts");

	// MCP over stateless HTTP.
	const rpc = async (method, params) =>
		(await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
	assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "kotoleaf");
	assert.deepEqual((await rpc("tools/list")).result.tools.map((t) => t.name), ["list_meetings", "transcript", "raw_messages"]);
	const call = await rpc("tools/call", { name: "transcript", arguments: { language: "ja" } });
	assert.match(call.result.content[0].text, /今日は meeting/);

	// Archive to R2 (HOT_DAYS=0 locally, so every meeting is old enough).
	const run = await (await fetch(`${base}/archive/run`, { method: "POST", headers: auth })).json();
	assert.equal(run.archived.length, 1);
	const listing = await (await fetch(`${base}/archive`, { headers: auth })).json();
	assert.equal(listing[0].id, run.archived[0]);
	const gz = await fetch(`${base}/archive/${run.archived[0]}`, { headers: auth });
	const { gunzipSync } = await import("node:zlib");
	const lines = gunzipSync(Buffer.from(await gz.arrayBuffer())).toString().trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(lines[0].meeting.id, run.archived[0]);
	assert.equal(lines[1].message.is_final, true);
	assert.deepEqual(await (await fetch(`${base}/meetings`, { headers: auth })).json(), [], "archived meetings leave hot storage");
	await stopWorker(); wrangler = startWorker(); await ready();
	const undone = (await (await learn()).json()).corrections[0];
	assert.equal(undone.active, 0, "undo survives runtime restart and archive");
	assert.equal(undone.reviews, 2);
	assert.equal(undone.last_rating, "known");
	assert.ok(undone.retracted >= undone.created);
	assert.deepEqual((await (await learn()).json()).last_hint_receipt, matchedReceipt, "receipt survives restart and archive without changing provenance");
	await stopWorker();
	receiptSql("CREATE TRIGGER fail_receipt BEFORE INSERT ON hint_receipts BEGIN SELECT RAISE(FAIL, 'synthetic receipt storage failure'); END");
	wrangler = startWorker(); await ready();
	const storageFailure = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	assert.equal(storageFailure.status, 200, "receipt failure must not lose successful dictation");
	assert.deepEqual(await storageFailure.json(), { text: "今日は meeting", language: "ja" });
	assert.equal(storageFailure.headers.get("x-kotoleaf-hint-receipt"), "unavailable");
	assert.deepEqual((await (await learn()).json()).last_hint_receipt, matchedReceipt, "failed receipt write retains previous timestamp and data");
	await stopWorker(); receiptSql("DROP TRIGGER fail_receipt");
	wrangler = startWorker(); await ready();
	await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	assert.deepEqual((await (await learn()).json()).last_hint_receipt.terms, [], "next dictation after undo records zero confirmed hints");
	if (process.env.KOTOLEAF_BROWSER_PYTHON) {
		await new Promise((resolve, reject) => {
			const browser = spawn(process.env.KOTOLEAF_BROWSER_PYTHON, ["test/browser-learning.py", `${base}/learn`], { stdio: "inherit" });
			browser.on("error", reject);
			browser.on("exit", code => code === 0 ? resolve() : reject(new Error(`mobile browser test exited ${code}`)));
		});
	}

	console.log("local e2e: all checks passed");
} finally {
	await stopWorker();
	mock.close();
	wss.close();
	rmSync(dir, { recursive: true, force: true });
	rmSync(".dev.vars", { force: true });
}
process.exit(0);
