import { DurableObject } from "cloudflare:workers";
import { dominantLanguage } from "./params";
import { archiveCutoff, nextArchiveTime } from "./schedule";
import { checkCapacity, type Correction, type CorrectionInput } from "./learning";
import type { HintReceipt } from "./hint-receipt";
import { ReviewStore } from "./review-store";

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
	private review: ReviewStore;

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
			CREATE TABLE IF NOT EXISTS corrections (
				owner TEXT NOT NULL, id TEXT NOT NULL, original TEXT NOT NULL, term TEXT NOT NULL,
				reading TEXT NOT NULL, meaning TEXT NOT NULL, created INTEGER NOT NULL,
				active INTEGER NOT NULL DEFAULT 1, retracted INTEGER,
				PRIMARY KEY (owner, id)
			);
			CREATE TABLE IF NOT EXISTS correction_reviews (
				owner TEXT NOT NULL, id TEXT NOT NULL, correction_id TEXT NOT NULL,
				rating TEXT NOT NULL, created INTEGER NOT NULL,
				PRIMARY KEY (owner, id)
			);
			CREATE INDEX IF NOT EXISTS reviews_by_correction ON correction_reviews (owner, correction_id, created);
			CREATE TABLE IF NOT EXISTS hint_receipts (
				owner TEXT PRIMARY KEY, completed INTEGER NOT NULL, receipt TEXT NOT NULL
			);
		`);
		// Added after v1: comma-delimited set of word languages, e.g. ",en,ja,".
		const columns = this.sql.exec("PRAGMA table_info(messages)").toArray().map((c) => c.name);
		if (!columns.includes("languages")) this.sql.exec("ALTER TABLE messages ADD COLUMN languages TEXT");
		this.review = new ReviewStore(this.sql, env, this, fn=>ctx.storage.transactionSync(fn));
	}

	context(owner: string) { return this.review.context(owner); }
	setContext(owner: string, context: string) { return this.review.setContext(owner, context); }
	reviewMeetings(owner: string) { return this.review.meetings(owner); }
	reviewData(owner: string, id: string) { return this.review.data(owner, id); }
	reviewRevision(owner: string, id: string, revision: string, review: string) { return this.review.decide(owner, id, revision, review); }
	learnFromRevision(owner: string, id: string, revision: string, index: number, input: CorrectionInput) { return this.review.learn(owner, id, revision, index, input); }
	async refineOwned(owner: string, id: string) { return this.review.owned(owner,id) ? this.review.refine(id,true,true) : {status:"not-found"}; }
	async importText(owner: string, requestId: string, text: string) {
		const id = `import-${requestId}`;
		const existing = this.sql.exec("SELECT source FROM meetings WHERE id = ?", id).toArray()[0];
		if (existing) {
			const original = this.sql.exec("SELECT text FROM messages WHERE meeting_id = ? ORDER BY seq",id).toArray().map(l=>l.text).join("\n\n");
			return existing.source === owner && original === text ? {status:200,id} : {status:409,error:"Import request id already used."};
		}
		const now = Date.now();
		this.ctx.storage.transactionSync(()=>{
			this.sql.exec("INSERT INTO meetings(id,source,started,ended) VALUES (?,?,?,?)",id,owner,now,now);
			text.split("\n\n").forEach((part,index)=>{
				const raw=JSON.stringify({type:"Results",is_final:true,origin:"user-pasted-text",channel:{alternatives:[{transcript:part}]}});
				this.sql.exec("INSERT INTO messages(meeting_id,seq,received,type,text,raw) VALUES (?,?,?,'Results',?,?)",id,index+1,now,part,raw);
			});
		});
		if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(nextArchiveTime(now));
		return {status:201,id};
	}

	corrections(owner: string): Correction[] {
		return this.sql.exec(`SELECT c.id, c.original, c.term, c.reading, c.meaning, c.created, c.active, c.retracted,
			(SELECT COUNT(*) FROM correction_reviews r WHERE r.owner = c.owner AND r.correction_id = c.id) AS reviews,
			(SELECT rating FROM correction_reviews r WHERE r.owner = c.owner AND r.correction_id = c.id ORDER BY created DESC, rowid DESC LIMIT 1) AS last_rating,
			(SELECT MAX(created) FROM correction_reviews r WHERE r.owner = c.owner AND r.correction_id = c.id) AS last_review
			FROM corrections c WHERE c.owner = ? ORDER BY c.created DESC, c.rowid DESC`, owner).toArray() as unknown as Correction[];
	}

	learningTerms(owner: string): string[] {
		return this.sql.exec("SELECT term FROM corrections WHERE owner = ? AND active = 1 ORDER BY created DESC, rowid DESC", owner).toArray().map((r) => r.term as string);
	}

	learningState(owner: string) {
		// One synchronous snapshot/RPC: displayed hints cannot disagree with the
		// displayed confirmations because an undo landed between separate reads.
		const corrections = this.corrections(owner);
		return { corrections, keyterms: corrections.filter(c => c.active).map(c => c.term), last_hint_receipt: this.lastHintReceipt(owner), sources: this.sql.exec("SELECT correction_id, meeting_id, revision, evidence FROM learning_sources WHERE owner = ?",owner).toArray() };
	}

	lastHintReceipt(owner: string): HintReceipt | null {
		const row = this.sql.exec("SELECT receipt FROM hint_receipts WHERE owner = ?", owner).toArray()[0];
		return row ? JSON.parse(row.receipt as string) : null;
	}

	saveHintReceipt(owner: string, receipt: HintReceipt): void {
		// One terms-only snapshot per label. A delayed write cannot replace a more
		// recently completed request. Undo never rewrites this historical snapshot.
		this.sql.exec(`INSERT INTO hint_receipts (owner, completed, receipt) VALUES (?, ?, ?)
			ON CONFLICT(owner) DO UPDATE SET completed = excluded.completed, receipt = excluded.receipt
			WHERE excluded.completed >= hint_receipts.completed`, owner, receipt.completed, JSON.stringify(receipt));
	}

	// Synchronous SQL operations do not yield: limit checks and writes are atomic
	// with respect to other requests in this Durable Object. IDs make retries safe.
	confirmCorrection(owner: string, input: CorrectionInput): { status: number; error?: string } {
		const all = this.corrections(owner);
		const existing = all.find((c) => c.id === input.id);
		if (existing) {
			return Object.entries(input).every(([k, v]) => existing[k as keyof CorrectionInput] === v)
				? { status: 200 } : { status: 409, error: "Request id already used for different content." };
		}
		try { checkCapacity(all.filter((c) => c.active), input); }
		catch (error) { return { status: 409, error: (error as Error).message }; }
		this.sql.exec("INSERT INTO corrections (owner, id, original, term, reading, meaning, created) VALUES (?, ?, ?, ?, ?, ?, ?)", owner, input.id, input.original, input.term, input.reading, input.meaning, Date.now());
		return { status: 201 };
	}

	undoCorrection(owner: string, id: string): boolean {
		const exists = this.sql.exec("SELECT id FROM corrections WHERE owner = ? AND id = ?", owner, id).toArray().length > 0;
		if (exists) this.sql.exec("UPDATE corrections SET active = 0, retracted = COALESCE(retracted, ?) WHERE owner = ? AND id = ?", Date.now(), owner, id);
		return exists;
	}

	reviewCorrection(owner: string, id: string, event: string, rating: string): { status: number; error?: string } {
		const previous = this.sql.exec("SELECT correction_id, rating FROM correction_reviews WHERE owner = ? AND id = ?", owner, event).toArray()[0];
		if (previous) return previous.correction_id === id && previous.rating === rating ? { status: 200 } : { status: 409, error: "Review id already used." };
		if (!this.sql.exec("SELECT id FROM corrections WHERE owner = ? AND id = ? AND active = 1", owner, id).toArray().length) return { status: 404, error: "Active correction not found." };
		this.sql.exec("INSERT INTO correction_reviews (owner, id, correction_id, rating, created) VALUES (?, ?, ?, ?, ?)", owner, event, id, rating, Date.now());
		return { status: 201 };
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
		this.ctx.waitUntil(this.review.refine(id, true));
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
			new Set(speakers).size === 1 ? speakers[0] : null,
			dominantLanguage(words) ?? alternative?.languages?.[0] ?? null,
			wordLanguages.length ? `,${wordLanguages.join(",")},` : null,
			alternative?.transcript ?? null,
			raw,
		);
		this.ctx.waitUntil(this.review.refine(id, false));
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
		await this.archiveOld();
		await this.ctx.storage.setAlarm(nextArchiveTime(Date.now()));
	}

	// Also callable on demand (POST /archive/run). Returns the archived meeting ids.
	async archiveOld(): Promise<string[]> {
		const archived: string[] = [];
		const cutoff = archiveCutoff(Date.now(), Number(this.env.HOT_DAYS || "7"));
		const old = this.sql.exec("SELECT id, source, started, ended FROM meetings WHERE started < ? AND ended IS NOT NULL AND NOT EXISTS (SELECT 1 FROM refinements r WHERE r.meeting_id = meetings.id AND r.state = 'running')", cutoff).toArray() as unknown as Meeting[];
		for (const meeting of old) {
			// Without an R2 binding nothing is deleted; meetings simply stay hot.
			if (!this.env.ARCHIVE) break;
			await this.archive(meeting);
			this.sql.exec("DELETE FROM refinement_decisions WHERE revision IN (SELECT id FROM refinements WHERE meeting_id = ?)",meeting.id);
			this.sql.exec("DELETE FROM refinements WHERE meeting_id = ?", meeting.id);
			this.sql.exec("DELETE FROM messages WHERE meeting_id = ?", meeting.id);
			this.sql.exec("DELETE FROM meetings WHERE id = ?", meeting.id);
			archived.push(meeting.id);
		}
		return archived;
	}

	private async archive(meeting: Meeting): Promise<void> {
		const lines = [JSON.stringify({ meeting })];
		const privateLines = [JSON.stringify({ meeting })];
		for (const row of this.sql.exec("SELECT * FROM refinements WHERE meeting_id = ? ORDER BY created", meeting.id)) {
			const { context, ...shared } = row;
			lines.push(JSON.stringify({refinement:shared}));
			privateLines.push(JSON.stringify({revision:row.id,context}));
		}
		for (const row of this.sql.exec("SELECT d.* FROM refinement_decisions d JOIN refinements r ON r.id = d.revision WHERE r.meeting_id = ? ORDER BY d.rowid",meeting.id)) lines.push(JSON.stringify({review_decision:row}));
		for (const row of this.sql.exec("SELECT seq, received, raw FROM messages WHERE meeting_id = ? ORDER BY seq", meeting.id)) {
			lines.push(`{"seq":${row.seq},"received":${row.received},"message":${row.raw}}`);
		}
		const gzip = new Blob([lines.join("\n") + "\n"]).stream().pipeThrough(new CompressionStream("gzip"));
		const body = await new Response(gzip).arrayBuffer();
		await this.env.ARCHIVE!.put(`meetings/${meeting.id}.jsonl.gz`, body, {
			httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
			customMetadata: { source: meeting.source, started: String(meeting.started) },
		});
		// Keep private snapshots, but never place them in the general-reader archive.
		// Both writes complete before archiveOld removes any hot database rows.
		if (privateLines.length > 1) {
			const privateBody = new Blob([privateLines.join("\n") + "\n"]).stream().pipeThrough(new CompressionStream("gzip"));
			await this.env.ARCHIVE!.put(`review-private/${meeting.id}.jsonl.gz`, await new Response(privateBody).arrayBuffer(), {
				httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
				customMetadata: { source: meeting.source },
			});
		}
	}
}
