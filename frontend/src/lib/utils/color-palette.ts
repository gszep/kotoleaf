const PALETTE = [
	'#e6194b',
	'#3cb44b',
	'#4363d8',
	'#f58231',
	'#911eb4',
	'#42d4f4',
	'#f032e6',
	'#469990',
	'#dcbeff',
	'#9a6324',
	'#800000',
	'#808000'
];

export function getTermColor(index: number): string {
	return PALETTE[index % PALETTE.length];
}
