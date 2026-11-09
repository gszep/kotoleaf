// Confirmed spellings are ASR hints, never search-and-replace rules or model facts.
export interface CorrectionInput {
	id: string;
	original: string;
	term: string;
	reading: string;
	meaning: string;
}
export interface Correction extends CorrectionInput {
	created: number;
	active: number;
	retracted: number | null;
	reviews: number;
	last_rating: string | null;
	last_review: number | null;
}

export class LearningError extends Error {
	status: number;
	constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function uuid(value: unknown): string {
	if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw new LearningError("A UUID request id is required; reuse it when retrying.");
	}
	return value.toLowerCase();
}

export function correctionInput(value: any): CorrectionInput {
	if (value?.confirmed !== true) throw new LearningError("Confirm the spelling before saving it.");
	const text = (key: string, max: number, required = false) => {
		const input = value[key] ?? "";
		if (typeof input !== "string") throw new LearningError(`${key} must be text.`);
		const result = input.trim().normalize("NFC");
		if ((required && !result) || result.length > max || /[\p{Cc}\p{Cf}]/u.test(result)) throw new LearningError(`Invalid ${key} (maximum ${max} characters, no control characters).`);
		return result;
	};
	const term = text("term", 48, true);
	if (new TextEncoder().encode(term).length > 48) throw new LearningError("Keep the spelling to 48 UTF-8 bytes (about 16 Japanese characters).");
	return { id: uuid(value.id), original: text("original", 100), term, reading: text("reading", 100), meaning: text("meaning", 200) };
}

export function checkCapacity(active: Correction[], input: CorrectionInput): void {
	if (active.some((c) => c.term === input.term)) throw new LearningError("This spelling is already active.", 409);
	// A small bounded personal glossary, leaving room for the existing institutional
	// glossary under Deepgram's 500-token limit. No tokenizer/library dependency.
	const bytes = new TextEncoder().encode(active.map((c) => c.term).join("") + input.term).length;
	if (active.length >= 16 || bytes > 240) throw new LearningError("Personal hint budget reached (16 terms / 240 UTF-8 bytes). Undo an unused term first.", 409);
}
