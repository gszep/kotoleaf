export type DisplayMode = 'portrait-shared' | 'portrait-solo' | 'landscape';
export type Register = 'workplace_polite' | 'formal' | 'casual';
export type JlptLevel = 'N1' | 'N2' | 'N3' | 'N4' | 'N5';

let displayMode = $state<DisplayMode>('portrait-shared');
let register = $state<Register>('workplace_polite');
let jlptThreshold = $state<JlptLevel>('N1');
let audioSource = $state<'microphone' | 'screen_share'>('microphone');

export function getDisplayMode(): DisplayMode {
	return displayMode;
}

export function setDisplayMode(mode: DisplayMode): void {
	displayMode = mode;
}

export function getRegister(): Register {
	return register;
}

export function setRegister(r: Register): void {
	register = r;
}

export function getJlptThreshold(): JlptLevel {
	return jlptThreshold;
}

export function setJlptThreshold(level: JlptLevel): void {
	jlptThreshold = level;
}

export function getAudioSource(): 'microphone' | 'screen_share' {
	return audioSource;
}

export function setAudioSource(source: 'microphone' | 'screen_share'): void {
	audioSource = source;
}
