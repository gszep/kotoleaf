import glossaryText from "../glossary.txt";
import { deepgramQuery, dominantLanguage, parseGlossary } from "./params";
import type { Line, Meeting } from "./store";

export { Transcripts } from "./store";

const glossary = parseGlossary(glossaryText);

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") return Response.json({ ok: true });

		const label = await authenticate(request, env);
		if (!label) return Response.json({ error: "unauthorized" }, { status: 401 });

		try {
			if (url.pathname.endsWith("/audio/transcriptions") && request.method === "POST") return await openaiTranscription(request, env);
			if (url.pathname === "/v1/listen") {
				if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") return await live(request, env, ctx, label);
				if (request.method === "POST") return await batch(request, env);
			}
			if (url.pathname === "/mcp") return await mcp(request, env);
			if (url.pathname.startsWith("/meetings")) return await meetings(url, env);
			if (url.pathname.startsWith("/archive")) return await archive(url, env);
			return Response.json({ error: "not found" }, { status: 404 });
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
		}
	},
} satisfies ExportedHandler<Env>;

// Access tokens are a secret of comma-separated `label:token` pairs. Clients send
// `Authorization: Bearer <token>` (OpenAI style) or `Token <token>` (Deepgram style).
async function authenticate(request: Request, env: Env): Promise<string | null> {
	const header = request.headers.get("Authorization") ?? "";
	const presented = header.replace(/^(Bearer|Token)\s+/i, "").trim();
	if (!presented) return null;
	const encoder = new TextEncoder();
	const given = encoder.encode(presented);
	for (const pair of (env.ACCESS_TOKENS ?? "").split(",")) {
		const index = pair.indexOf(":");
		if (index < 1) continue;
		const expected = encoder.encode(pair.slice(index + 1).trim());
		if (expected.byteLength === given.byteLength && (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }).timingSafeEqual(expected, given)) {
			return pair.slice(0, index).trim();
		}
	}
	return null;
}

function store(env: Env) {
	return env.TRANSCRIPTS.get(env.TRANSCRIPTS.idFromName("main"));
}

function deepgramHeaders(env: Env, contentType?: string | null): HeadersInit {
	return { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, ...(contentType ? { "Content-Type": contentType } : {}) };
}

// OpenAI-compatible route for Paseo dictation (`OPENAI_STT_BASE_URL=<origin>/v1`).
// The requested model and language are ignored in favour of EN/JA code-switching.
async function openaiTranscription(request: Request, env: Env): Promise<Response> {
	const form = await request.formData();
	const file = form.get("file");
	if (!file || typeof file === "string") return Response.json({ error: { message: "missing file" } }, { status: 400 });
	const query = deepgramQuery(new URLSearchParams(), glossary, "batch");
	const response = await fetch(`${env.DEEPGRAM_URL}?${query}`, {
		method: "POST",
		headers: deepgramHeaders(env, file.type || "audio/wav"),
		body: file.stream(),
	});
	if (!response.ok) return Response.json({ error: { message: await response.text() } }, { status: response.status });
	const result: any = await response.json();
	const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
	return Response.json({
		text: alternative?.transcript ?? "",
		language: dominantLanguage(alternative?.words) ?? alternative?.languages?.[0],
	});
}

// Deepgram-compatible pre-recorded route (Anarlog after-recording). The body is
// streamed through unchanged; only the query is rewritten. Results are not stored.
async function batch(request: Request, env: Env): Promise<Response> {
	const query = deepgramQuery(new URL(request.url).searchParams, glossary, "batch");
	const response = await fetch(`${env.DEEPGRAM_URL}?${query}`, {
		method: "POST",
		headers: deepgramHeaders(env, request.headers.get("Content-Type")),
		body: request.body,
	});
	return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" } });
}

// Deepgram-compatible streaming route (Anarlog live). Audio frames pass through;
// every non-interim message from Deepgram is also stored verbatim for agents.
async function live(request: Request, env: Env, ctx: ExecutionContext, label: string): Promise<Response> {
	const query = deepgramQuery(new URL(request.url).searchParams, glossary, "live");
	const upstreamResponse = await fetch(`${env.DEEPGRAM_URL}?${query}`, { headers: { Upgrade: "websocket", ...deepgramHeaders(env) } });
	const upstream = upstreamResponse.webSocket;
	if (!upstream) return new Response(await upstreamResponse.text(), { status: upstreamResponse.status || 502 });
	upstream.accept();

	const [client, server] = Object.values(new WebSocketPair());
	server.accept();
	// Newer compatibility dates deliver binary frames as Blob; audio must pass through as bytes.
	for (const socket of [server, upstream]) (socket as unknown as { binaryType: string }).binaryType = "arraybuffer";

	const transcripts = store(env);
	const meeting = await transcripts.start(label);
	// Writes are chained so stored messages keep Deepgram's order.
	let writes: Promise<unknown> = Promise.resolve();
	let closed = false;
	const finish = (code: number, reason: string, target: WebSocket) => {
		if (closed) return;
		closed = true;
		writes = writes.then(() => transcripts.end(meeting));
		// The connection is gone by now; keep the Worker alive until pending writes land.
		ctx.waitUntil(writes);
		try {
			target.close(validCloseCode(code), reason);
		} catch {}
	};

	server.addEventListener("message", (event) => {
		try {
			upstream.send(event.data);
		} catch {}
	});
	upstream.addEventListener("message", (event) => {
		try {
			server.send(event.data);
		} catch {}
		// Interim results are not stored, so skip the storage call for them (a cheap string check, no parse).
		if (typeof event.data === "string" && !event.data.includes('"is_final":false')) {
			const data = event.data;
			writes = writes.then(() => transcripts.append(meeting, data)).catch(() => {});
		}
	});
	server.addEventListener("close", (event) => finish(event.code, event.reason, upstream));
	upstream.addEventListener("close", (event) => finish(event.code, event.reason, server));
	server.addEventListener("error", () => finish(1011, "client error", upstream));
	upstream.addEventListener("error", () => finish(1011, "upstream error", server));

	return new Response(null, { status: 101, webSocket: client, headers: { "x-kotoleaf-meeting": meeting } });
}

function validCloseCode(code: number): number {
	return code === 1000 || (code >= 3000 && code <= 4999) || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ? code : 1000;
}

// ---- Reading transcripts -------------------------------------------------

async function resolveMeeting(env: Env, id?: string | null): Promise<Meeting | null> {
	const transcripts = store(env);
	if (id && id !== "latest") return (await transcripts.meetings(500)).find((m) => m.id === id) ?? null;
	return transcripts.latest();
}

function formatLines(meeting: Meeting, lines: Line[]): string {
	const header = `meeting ${meeting.id} (${meeting.ended ? "ended" : "live"}), started ${new Date(meeting.started).toISOString()}`;
	const body = lines.map((line) => {
		const t = Math.max(0, Math.floor(line.start ?? 0));
		const stamp = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
		const who = [line.channel !== null ? `ch${line.channel}` : "", line.speaker !== null ? `S${line.speaker}` : ""].filter(Boolean).join(" ");
		const languages = line.languages ? line.languages.split(",").filter(Boolean).join("+") : line.language;
		return `[${stamp}]${who ? ` ${who}` : ""}${languages ? ` ${languages}` : ""}: ${line.text}`;
	});
	const next = lines.length ? lines[lines.length - 1].seq : null;
	return [header, ...body, next !== null ? `next_since: ${next}` : "no new lines"].join("\n");
}

async function readTranscript(env: Env, args: { meeting_id?: string; since?: number; minutes?: number; language?: string }): Promise<string> {
	const meeting = await resolveMeeting(env, args.meeting_id);
	if (!meeting) return "no meetings recorded";
	const lines = await store(env).lines(meeting.id, { since: args.since, minutes: args.minutes, language: args.language });
	return formatLines(meeting, lines);
}

async function readRaw(env: Env, args: { meeting_id?: string; since?: number; limit?: number }): Promise<string> {
	const meeting = await resolveMeeting(env, args.meeting_id);
	if (!meeting) return "no meetings recorded";
	const rows = await store(env).raw(meeting.id, args.since ?? 0, Math.min(args.limit ?? 50, 200));
	return rows.map((row) => `${row.seq}\t${row.raw}`).join("\n") || "no new messages";
}

// GET /meetings, /meetings/<id|latest>/transcript?since=&minutes=&language=, /meetings/<id|latest>/raw?since=&limit=
async function meetings(url: URL, env: Env): Promise<Response> {
	const parts = url.pathname.split("/").filter(Boolean);
	const number = (key: string) => (url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined);
	if (parts.length === 1) return Response.json(await store(env).meetings(number("limit") ?? 20));
	const [, id, view] = parts;
	if (view === "transcript") {
		return new Response(await readTranscript(env, { meeting_id: id, since: number("since"), minutes: number("minutes"), language: url.searchParams.get("language") ?? undefined }));
	}
	if (view === "raw") return new Response(await readRaw(env, { meeting_id: id, since: number("since"), limit: number("limit") }));
	return Response.json({ error: "not found" }, { status: 404 });
}

// GET /archive lists archived meetings; GET /archive/<id> returns its gzipped JSON lines.
async function archive(url: URL, env: Env): Promise<Response> {
	if (!env.ARCHIVE) return Response.json({ error: "archive storage not configured" }, { status: 503 });
	const id = url.pathname.split("/").filter(Boolean)[1];
	if (!id) {
		const listing = await env.ARCHIVE.list({ prefix: "meetings/", limit: 1000 });
		return Response.json(listing.objects.map((o) => ({ id: o.key.slice(9, -9), bytes: o.size, ...o.customMetadata })));
	}
	const object = await env.ARCHIVE.get(`meetings/${id}.jsonl.gz`);
	if (!object) return Response.json({ error: "not found" }, { status: 404 });
	return new Response(object.body, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${id}.jsonl.gz"` } });
}

// ---- MCP (stateless streamable HTTP, JSON responses) ---------------------

const TOOLS = [
	{
		name: "list_meetings",
		description: "List meetings from roughly the last one to two weeks (newest first), with whether each is still live. Older meetings are archived; download them from GET /archive/<id>.",
		inputSchema: { type: "object", properties: { limit: { type: "number", description: "Default 20" } } },
	},
	{
		name: "transcript",
		description:
			"Read a meeting transcript as compact lines '[mm:ss] channel speaker language: text'. Defaults to the latest meeting. Use `since` with the returned next_since to fetch only new lines, or `minutes` for the most recent part. Per-word language tags are unreliable for katakana loanwords and names, so read surrounding lines rather than relying only on the language filter.",
		inputSchema: {
			type: "object",
			properties: {
				meeting_id: { type: "string" },
				since: { type: "number" },
				minutes: { type: "number" },
				language: { type: "string", enum: ["en", "ja"] },
			},
		},
	},
	{
		name: "raw_messages",
		description: "Read stored Deepgram messages verbatim (word timings, confidences, speakers, languages, metadata). Use sparingly; prefer `transcript`.",
		inputSchema: { type: "object", properties: { meeting_id: { type: "string" }, since: { type: "number" }, limit: { type: "number", description: "Default 50, max 200" } } },
	},
];

async function mcp(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
	const message: any = await request.json();
	if (message?.id === undefined) return new Response(null, { status: 202 }); // notification
	const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });
	switch (message.method) {
		case "initialize":
			return reply({
				protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "kotoleaf", version: "0.1.0" },
			});
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools: TOOLS });
		case "tools/call": {
			const args = message.params?.arguments ?? {};
			const name = message.params?.name;
			const text =
				name === "list_meetings"
					? JSON.stringify(await store(env).meetings(args.limit ?? 20))
					: name === "transcript"
						? await readTranscript(env, args)
						: name === "raw_messages"
							? await readRaw(env, args)
							: null;
			if (text === null) return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `unknown tool ${name}` } });
			return reply({ content: [{ type: "text", text }] });
		}
		default:
			return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } });
	}
}
