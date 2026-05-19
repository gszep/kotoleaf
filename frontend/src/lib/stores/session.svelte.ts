export interface TermPair {
	index: number;
	jp_term: string;
	reading: string;
	en_term: string;
	color?: string;
}

export interface Summary {
	summary_id: string;
	en_html: string;
	jp_html: string;
	term_pairs: TermPair[];
}

export interface TranscriptEntry {
	text: string;
	speaker: string;
	is_final: boolean;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'listening' | 'processing' | 'error';

let summaries = $state<Summary[]>([]);
let transcript = $state<TranscriptEntry[]>([]);
let connectionState = $state<ConnectionState>('disconnected');

export function getSummaries(): Summary[] {
	return summaries;
}

export function getLatestSummaryId(): string | null {
	return summaries.length > 0 ? summaries[summaries.length - 1].summary_id : null;
}

export function addSummary(summary: Summary): void {
	summaries = [...summaries, summary];
}

export function getTranscript(): TranscriptEntry[] {
	return transcript;
}

export function addTranscriptEntry(entry: TranscriptEntry): void {
	transcript = [...transcript, entry];
}

export function getConnectionState(): ConnectionState {
	return connectionState;
}

export function setConnectionState(state: ConnectionState): void {
	connectionState = state;
}

export function clearSession(): void {
	summaries = [];
	transcript = [];
	connectionState = 'disconnected';
}
