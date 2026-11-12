import type { Line, Meeting } from "./store";
import type { Correction, CorrectionInput } from "./learning";
import grounding from "../../backend/app/mind/grounding.txt";
import institution from "../../backend/app/mind/institution.txt";
import { contextPayload, generateRefinement, refinementConfigured, type Refinement } from "./refinement";

interface Sources {
 lines(id: string, options?: {since?:number}): Line[];
 corrections(owner: string): Correction[];
 confirmCorrection(owner: string, input: CorrectionInput): {status:number;error?:string};
}
export interface Revision {
 id:string; meeting_id:string; since_seq:number; until_seq:number; created:number; completed:number|null;
 state:string; review:string; sources:Line[]; result:Refinement|null; model:string|null; elapsed_ms:number|null; error:string|null;
 context:{context:string;confirmed_vocabulary:Array<{original:string;term:string;reading:string;meaning:string}>;previous_source_context:Line[]};
}
export interface ReviewData {
 meeting:Meeting; lines:Line[]; revisions:Revision[]; configured:boolean;
 decisions:Array<{revision:string;review:string;created:number}>;
}

export class ReviewStore {
 constructor(private sql: SqlStorage, private env: Env, private source: Sources, private transaction: <T>(fn:()=>T)=>T) {
  sql.exec(`CREATE TABLE IF NOT EXISTS meeting_context (owner TEXT PRIMARY KEY, context TEXT NOT NULL, updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS refinements (
    id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, since_seq INTEGER NOT NULL, until_seq INTEGER NOT NULL,
    created INTEGER NOT NULL, completed INTEGER, state TEXT NOT NULL, review TEXT NOT NULL DEFAULT 'draft',
    context TEXT NOT NULL, sources TEXT NOT NULL, result TEXT, model TEXT, elapsed_ms INTEGER, error TEXT
   );
   CREATE INDEX IF NOT EXISTS refinements_by_meeting ON refinements(meeting_id, created);
   CREATE TABLE IF NOT EXISTS learning_sources (owner TEXT NOT NULL, correction_id TEXT NOT NULL, meeting_id TEXT NOT NULL, revision TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(owner, correction_id));
   CREATE TABLE IF NOT EXISTS refinement_decisions (revision TEXT NOT NULL, review TEXT NOT NULL, created INTEGER NOT NULL);`);
 }
 context(owner: string): string {
  return this.sql.exec("SELECT context FROM meeting_context WHERE owner = ?", owner).toArray()[0]?.context as string ?? "";
 }
 setContext(owner: string, context: string): void {
  this.sql.exec("INSERT INTO meeting_context VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET context = excluded.context, updated = excluded.updated", owner, context, Date.now());
 }
 owned(owner: string, id: string): Meeting | null {
  return this.sql.exec("SELECT id, source, started, ended FROM meetings WHERE id = ? AND source = ?", id, owner).toArray()[0] as unknown as Meeting ?? null;
 }
 meetings(owner: string): Meeting[] {
  return this.sql.exec("SELECT id, source, started, ended FROM meetings WHERE source = ? ORDER BY started DESC LIMIT 50", owner).toArray() as unknown as Meeting[];
 }
 data(owner: string, id: string): ReviewData | null {
  const meeting = this.owned(owner, id);
  if (!meeting) return null;
  const revisions = this.sql.exec("SELECT * FROM refinements WHERE meeting_id = ? ORDER BY created, rowid", id).toArray().map(r => ({...r, sources: JSON.parse(r.sources as string), context: JSON.parse(r.context as string), result: r.result ? JSON.parse(r.result as string) : null})) as Revision[];
  const decisions = this.sql.exec("SELECT d.* FROM refinement_decisions d JOIN refinements r ON r.id = d.revision WHERE r.meeting_id = ? ORDER BY d.rowid",id).toArray() as unknown as ReviewData["decisions"];
  return {meeting, lines: this.source.lines(id), revisions, decisions, configured: refinementConfigured(this.env)};
 }
 decide(owner: string, meeting: string, revision: string, review: string): boolean {
  if (!this.owned(owner, meeting)) return false;
  const row = this.sql.exec("SELECT id, review FROM refinements WHERE id = ? AND meeting_id = ? AND state = 'ready'", revision, meeting).toArray()[0];
  if (!row) return false;
  if(row.review !== review) {
   this.transaction(()=>{
    this.sql.exec("INSERT INTO refinement_decisions VALUES (?,?,?)",revision,review,Date.now());
    this.sql.exec("UPDATE refinements SET review = ? WHERE id = ?", review, revision);
   });
  }
  return true;
 }
 learn(owner: string, meeting: string, revision: string, index: number, input: CorrectionInput) {
  if (!this.owned(owner, meeting)) return {status:404,error:"Meeting not found."};
  const row = this.sql.exec("SELECT result FROM refinements WHERE id = ? AND meeting_id = ? AND state = 'ready'", revision, meeting).toArray()[0];
  const term = row ? (JSON.parse(row.result as string) as Refinement).terms[index] : null;
  if (!term) return {status:404,error:"Learning candidate not found."};
  const previous = this.sql.exec("SELECT meeting_id, revision, evidence FROM learning_sources WHERE owner = ? AND correction_id = ?", owner, input.id).toArray()[0];
  const evidence = JSON.stringify(term.evidence);
  if (previous && (previous.meeting_id !== meeting || previous.revision !== revision || previous.evidence !== evidence)) return {status:409,error:"Request id already used."};
  return this.transaction(()=>{
   const result = this.source.confirmCorrection(owner, input);
   if (result.status < 300) this.sql.exec("INSERT OR IGNORE INTO learning_sources VALUES (?, ?, ?, ?, ?)", owner, input.id, meeting, revision, evidence);
   return result;
  });
 }
 // Request-owned work, not a schedule. Raw ingestion never awaits the model.
 // The durable running row gives single-flight across browser/live callers.
 async refine(id: string, flush: boolean, explicit = false): Promise<{status:string}> {
  if (!refinementConfigured(this.env)) return {status:"not-configured"};
  const meeting = this.sql.exec("SELECT id, source, started, ended FROM meetings WHERE id = ?", id).toArray()[0] as unknown as Meeting;
  if (!meeting) return {status:"not-found"};
  if (!explicit && meeting.source !== this.env.AUTO_REFINE_LABEL) return {status:"manual-only"};
  const now = Date.now();
  this.sql.exec("UPDATE refinements SET state = 'failed', error = 'interrupted' WHERE meeting_id = ? AND state = 'running' AND created < ?", id, now - 90000);
  if (this.sql.exec("SELECT id FROM refinements WHERE meeting_id = ? AND state = 'running'", id).toArray().length) return {status:"running"};
  const last = this.sql.exec("SELECT created, state FROM refinements WHERE meeting_id = ? ORDER BY created DESC, rowid DESC LIMIT 1", id).toArray()[0];
  if (last && now - (last.created as number) < 30000 && (!flush || last.state === 'failed')) return {status:"cooldown"};
  const cursor = this.sql.exec("SELECT COALESCE(MAX(until_seq),0) AS n FROM refinements WHERE meeting_id = ? AND state = 'ready'", id).one().n as number;
  const pending = this.source.lines(id, {since:cursor});
  if (!pending.length) return {status:"up-to-date"};
  const span = (pending.at(-1)?.end ?? 0) - (pending[0].start ?? 0);
  if (!flush && !meeting.ended && span < 30 && pending.reduce((n,l)=>n+l.text.length,0) < 1500) return {status:"buffering"};
  const lines: Line[] = [];
  let chars = 0;
  for (const line of pending.slice(0,32)) { if (chars + line.text.length > 12000) break; lines.push(line); chars += line.text.length; }
  if (!lines.length) return {status:"source-too-large"};
  const previous = this.source.lines(id).filter(l=>l.seq<=cursor).slice(-2);
  const payload = {...contextPayload(lines, this.source.corrections(meeting.source), this.context(meeting.source)), previous_source_context:previous.filter(l=>l.text.length<=3000)};
  const revision = crypto.randomUUID();
  this.sql.exec("INSERT INTO refinements(id,meeting_id,since_seq,until_seq,created,state,context,sources) VALUES (?,?,?,?,?,'running',?,?)", revision,id,cursor,lines.at(-1)!.seq,now,JSON.stringify({context:payload.context,confirmed_vocabulary:payload.confirmed_vocabulary,previous_source_context:payload.previous_source_context}),JSON.stringify(lines));
  try {
   const generated = await generateRefinement(this.env, grounding + "\n" + institution, payload);
   this.sql.exec("UPDATE refinements SET state='ready', completed=?, result=?, model=?, elapsed_ms=? WHERE id=?",Date.now(),JSON.stringify(generated.result),generated.model,generated.elapsed_ms,revision);
   // If the stream closed while this call ran, flush its final tail rather than
   // treating the last 30-second transport window as the meeting boundary.
   if (!flush && this.sql.exec("SELECT ended FROM meetings WHERE id = ?",id).toArray()[0]?.ended) await this.refine(id,true,explicit);
   return {status:"ready"};
  } catch (error) {
   const reason = error instanceof Error && error.message.startsWith("refinement upstream HTTP") ? error.message : "Refinement failed or invalid; raw transcript preserved.";
   this.sql.exec("UPDATE refinements SET state='failed', completed=?, error=? WHERE id=?",Date.now(),reason,revision);
   return {status:"failed"};
  }
 }
}
