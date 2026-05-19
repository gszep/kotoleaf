export interface ParsedTerm {
	term: string;
	reading?: string;
	index: number;
}

const BRACKET_PATTERN = /\{([^}|]+)(?:\|([^}]+))?\}\[(\d+)\]/g;

export function parseBracketedTerms(text: string): ParsedTerm[] {
	const terms: ParsedTerm[] = [];
	let match: RegExpExecArray | null;

	while ((match = BRACKET_PATTERN.exec(text)) !== null) {
		terms.push({
			term: match[1],
			reading: match[2] || undefined,
			index: parseInt(match[3], 10)
		});
	}

	BRACKET_PATTERN.lastIndex = 0;
	return terms;
}

export function stripBracketSyntax(text: string): string {
	return text.replace(BRACKET_PATTERN, '$1');
}
