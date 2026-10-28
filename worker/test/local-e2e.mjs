// Local end-to-end check: runs `wrangler dev` against a mock Deepgram server and
// exercises every route. No real credentials or audio are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const MOCK_PORT = 18787;
const WORKER_PORT = 18788;
const TOKEN = "local-test-token";
const seen = [];

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
	seen.push({ url: req.url, auth: req.headers.authorization });
	req.resume();
	req.on("end", () => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "今日は meeting", words }] }] } }));
	});
});
const wss = new WebSocketServer({ server: mock });
wss.on("connection", (socket, req) => {
	seen.push({ url: req.url, auth: req.headers.authorization, ws: true });
	socket.on("message", (_data, isBinary) => {
		if (!isBinary) return;
		socket.send(JSON.stringify(result(false, "今日", words.slice(0, 1))));
		socket.send(JSON.stringify(result(true, "今日は meeting", words)));
	});
});
await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));

const dir = mkdtempSync(join(tmpdir(), "kotoleaf-e2e-"));
writeFileSync(".dev.vars", `DEEPGRAM_API_KEY=mock-deepgram-key\nACCESS_TOKENS=local:${TOKEN}\n`);
const wrangler = spawn(
	"npx",
	["wrangler", "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", dir, "--var", `DEEPGRAM_URL:http://127.0.0.1:${MOCK_PORT}/v1/listen`, "--var", "HOT_DAYS:0"],
	{ stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
wrangler.stdout.on("data", (d) => (log += d));
wrangler.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${WORKER_PORT}`;
const auth = { Authorization: `Bearer ${TOKEN}` };
try {
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {}
		if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`);
		await new Promise((r) => setTimeout(r, 500));
	}

	console.log("worker up");
	assert.equal((await fetch(`${base}/meetings`)).status, 401, "unauthenticated request rejected");

	// OpenAI-compatible dictation route.
	const form = new FormData();
	form.append("file", new Blob([new Uint8Array(64)], { type: "audio/wav" }), "audio.wav");
	form.append("model", "whisper-1");
	form.append("language", "en");
	const openai = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: auth, body: form });
	assert.equal(openai.status, 200, await openai.clone().text());
	assert.deepEqual(await openai.json(), { text: "今日は meeting", language: "ja" });
	const dictation = new URL(seen.at(-1).url, "http://x").searchParams;
	assert.equal(dictation.get("model"), "nova-3");
	assert.equal(dictation.get("language"), "multi");
	assert.deepEqual(dictation.getAll("language_hint"), ["en", "ja"]);
	assert.ok(dictation.getAll("keyterm").includes("Kotoleaf"));
	assert.equal(seen.at(-1).auth, "Token mock-deepgram-key", "worker substitutes the Deepgram key");

	// Deepgram-compatible pre-recorded route.
	const batch = await fetch(`${base}/v1/listen?model=nova-2&language=en&detect_language=en&diarize=true`, {
		method: "POST",
		headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "audio/wav" },
		body: new Uint8Array(64),
	});
	assert.equal(batch.status, 200);
	const batchQuery = new URL(seen.at(-1).url, "http://x").searchParams;
	assert.equal(batchQuery.get("language"), "multi");
	assert.equal(batchQuery.has("detect_language"), false);
	assert.equal(batchQuery.get("diarize"), "true");

	console.log("http routes ok");
	// Deepgram-compatible live route: relay plus storage of non-interim messages.
	const socket = new WebSocket(`ws://127.0.0.1:${WORKER_PORT}/v1/listen?encoding=linear16&sample_rate=16000&channels=2&multichannel=true`, {
		headers: { Authorization: `Token ${TOKEN}` },
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

	console.log("local e2e: all checks passed");
} finally {
	wrangler.kill("SIGTERM");
	mock.close();
	wss.close();
	rmSync(dir, { recursive: true, force: true });
	rmSync(".dev.vars", { force: true });
}
process.exit(0);
