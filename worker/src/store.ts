import { DurableObject } from "cloudflare:workers";
import { dominantLanguage } from "./params";
import { archiveCutoff, nextArchiveTime } from "./schedule";

// One SQLite-backed Durable Object instance ("main") holds every meeting.
// Each non-interim Deepgram message is stored verbatim in `raw`; the other
// columns are derived only so listings can be filtered cheaply.

export interface Line {
	seq: number;
	start: number | null;
	end: number | null;
	channel: number | null;
	speaker: number | null;
	language: string | null;
	languages: string | null;
	text: string;
}

export interface Meeting {
	id: string;
	source: string;
	started: number;
	ended: number | null;
}

export class Transcripts extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS meetings (
				id TEXT PRIMARY KEY, source TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER
			);
			CREATE TABLE IF NOT EXISTS messages (
				meeting_id TEXT NOT NULL, seq INTEGER NOT NULL, received INTEGER NOT NULL,
				type TEXT, start REAL, end REAL, channel INTEGER, speaker INTEGER,
				language TEXT, text TEXT, raw TEXT NOT NULL,
				PRIMARY KEY (meeting_id, seq)
			);
		`);
		// Added after v1: comma-delimited set of word languages, e.g. ",en,ja,".
		const columns = this.sql.exec("PRAGMA table_info(messages)").toArray().map((c) => c.name);
		if (!columns.includes("languages")) this.sql.exec("ALTER TABLE messages ADD COLUMN languages TEXT");
	}

	async start(source: string): Promise<string> {
		const now = Date.now();
		const id = `${new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${crypto.randomUUID().slice(0, 4)}`;
		this.sql.exec("INSERT INTO meetings (id, source, started) VALUES (?, ?, ?)", id, source, now);
		if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(nextArchiveTime(now));
		return id;
	}

	end(id: string): void {
		this.sql.exec("UPDATE meetings SET ended = ? WHERE id = ? AND ended IS NULL", Date.now(), id);
	}

	append(id: string, raw: string): void {
		let message: any;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		// Interim results are superseded by their final version; keep finals and all other events.
		if (message?.type === "Results" && !message.is_final) return;

		const alternative = message?.channel?.alternatives?.[0];
		const words: any[] | undefined = alternative?.words;
		const speakers = (words ?? []).map((w) => w.speaker).filter((s) => typeof s === "number");
		const wordLanguages = [...new Set((words ?? []).map((w) => w.language).filter(Boolean))].sort();
		const seq = (this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE meeting_id = ?", id).one().n as number);
		this.sql.exec(
			"INSERT INTO messages (meeting_id, seq, received, type, start, end, channel, speaker, language, languages, text, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			seq,
			Date.now(),
			message?.type ?? null,
			typeof message?.start === "number" ? message.start : null,
			typeof message?.start === "number" && typeof message?.duration === "number" ? message.start + message.duration : null,
			Array.isArray(message?.channel_index) ? message.channel_index[0] : null,
			speakers.length ? mode(speakers) : null,
			dominantLanguage(words) ?? alternative?.languages?.[0] ?? null,
			wordLanguages.length ? `,${wordLanguages.join(",")},` : null,
			alternative?.transcript ?? null,
			raw,
		);
	}

	meetings(limit = 20): Meeting[] {
		return this.sql
			.exec("SELECT id, source, started, ended FROM meetings ORDER BY started DESC LIMIT ?", limit)
			.toArray() as unknown as Meeting[];
	}

	latest(): Meeting | null {
		return (this.meetings(1)[0] ?? null);
	}

	lines(id: string, options: { since?: number; minutes?: number; language?: string } = {}): Line[] {
		let minStart = -1;
		if (options.minutes) {
			const last = this.sql.exec("SELECT MAX(end) AS e FROM messages WHERE meeting_id = ?", id).one().e as number | null;
			if (last !== null) minStart = last - options.minutes * 60;
		}
		const rows = this.sql
			.exec(
				`SELECT seq, start, end, channel, speaker, language, languages, text FROM messages
				 WHERE meeting_id = ? AND type = 'Results' AND text != '' AND seq > ? AND COALESCE(start, 0) >= ?
				 ${options.language ? "AND (languages LIKE ? OR (languages IS NULL AND language = ?))" : ""} ORDER BY seq`,
				...[id, options.since ?? 0, minStart, ...(options.language ? [`%,${options.language},%`, options.language] : [])],
			)
			.toArray();
		return rows as unknown as Line[];
	}

	raw(id: string, since = 0, limit = 200): Array<{ seq: number; raw: string }> {
		return this.sql
			.exec("SELECT seq, raw FROM messages WHERE meeting_id = ? AND seq > ? ORDER BY seq LIMIT ?", id, since, limit)
			.toArray() as unknown as Array<{ seq: number; raw: string }>;
	}

	// Weekly: compress each meeting older than HOT_DAYS into one JSON-lines file in R2
	// (a metadata line, then one line per stored Deepgram message), then delete it here.
	async alarm(): Promise<void> {
		const cutoff = archiveCutoff(Date.now(), Number(this.env.HOT_DAYS || "7"));
		const old = this.sql.exec("SELECT id, source, started, ended FROM meetings WHERE started < ?", cutoff).toArray() as unknown as Meeting[];
		for (const meeting of old) {
			// Without an R2 binding nothing is deleted; meetings simply stay hot.
			if (!this.env.ARCHIVE) break;
			await this.archive(meeting);
			this.sql.exec("DELETE FROM messages WHERE meeting_id = ?", meeting.id);
			this.sql.exec("DELETE FROM meetings WHERE id = ?", meeting.id);
		}
		await this.ctx.storage.setAlarm(nextArchiveTime(Date.now()));
	}

	private async archive(meeting: Meeting): Promise<void> {
		const lines = [JSON.stringify({ meeting })];
		for (const row of this.sql.exec("SELECT seq, received, raw FROM messages WHERE meeting_id = ? ORDER BY seq", meeting.id)) {
			lines.push(`{"seq":${row.seq},"received":${row.received},"message":${row.raw}}`);
		}
		const gzip = new Blob([lines.join("\n") + "\n"]).stream().pipeThrough(new CompressionStream("gzip"));
		const body = await new Response(gzip).arrayBuffer();
		await this.env.ARCHIVE!.put(`meetings/${meeting.id}.jsonl.gz`, body, {
			httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
			customMetadata: { source: meeting.source, started: String(meeting.started) },
		});
	}
}

function mode(values: number[]): number {
	const counts = new Map<number, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
