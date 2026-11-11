// Observation, not attribution: a literal occurrence does not prove that a hint
// caused recognition, nor that the recognised spelling was correct.
export interface HintReceipt {
	id: string;
	started: number;
	completed: number;
	terms: Array<{ term: string; appeared: boolean }>;
}

export function hintReceipt(id: string, started: number, completed: number, terms: string[], transcript: string): HintReceipt {
	const text = transcript.normalize("NFC");
	return { id, started, completed, terms: [...new Set(terms)].filter(Boolean).map(term => ({
		term, appeared: text.includes(term.normalize("NFC")),
	})) };
}
