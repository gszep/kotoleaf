import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { startLessonRecording } from './lesson-recorder.ts';

class Track extends EventTarget {
	stops = 0;
	stop() { this.stops++; }
}

function fixture(options: { noTabAudio?: boolean; rejectMicrophone?: boolean; maxBytes?: number } = {}) {
	const mic = new Track();
	const tabAudio = new Track();
	const tabVideo = new Track();
	const mixedTrack = new Track();
	const stream = (audio: Track[], video: Track[] = []) => ({
		getAudioTracks: () => audio,
		getTracks: () => [...audio, ...video]
	}) as unknown as MediaStream;
	const micStream = stream([mic]);
	const tabStream = stream(options.noTabAudio ? [] : [tabAudio], [tabVideo]);
	const mixed = stream([mixedTrack]);
	const inputs: MediaStream[] = [];
	const captureOrder: string[] = [];
	let closed = 0;
	let instance: Recorder;
	class Recorder {
		static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
		state = 'inactive';
		mimeType = 'audio/webm;codecs=opus';
		ondataavailable?: (event: { data: Blob }) => void;
		onstop?: () => void;
		onerror?: () => void;
		stops = 0;
		constructor(input: MediaStream) {
			assert.equal(input, mixed);
			instance = this;
		}
		start() { this.state = 'recording'; }
		chunk(text: string) { this.ondataavailable?.({ data: new Blob([text]) }); }
		stop() {
			this.stops++;
			this.state = 'inactive';
			queueMicrotask(() => {
				this.chunk('最後の words');
				this.onstop?.();
			});
		}
	}
	const dependencies = {
		devices: {
			getDisplayMedia: async () => { captureOrder.push('tab'); return tabStream; },
			getUserMedia: async () => {
				captureOrder.push('mic');
				if (options.rejectMicrophone) throw new Error('permission denied');
				return micStream;
			}
		},
		createContext: () => ({
			resume: async () => {},
			close: async () => { closed++; },
			createMediaStreamDestination: () => ({ stream: mixed }),
			createMediaStreamSource: (input: MediaStream) => {
				inputs.push(input); return { connect: () => {} };
			},
			createGain: () => ({ gain: { value: 1 }, connect: () => {} })
		}) as unknown as AudioContext,
		Recorder: Recorder as unknown as typeof MediaRecorder,
		maxBytes: options.maxBytes
	};
	const blobs: Blob[] = [];
	const notices: string[] = [];
	return {
		dependencies, blobs, notices, inputs, captureOrder, mic, tabAudio, tabVideo, mixedTrack,
		get recorder() { return instance!; },
		get closed() { return closed; },
		start: (mode: 'meeting' | 'microphone') => startLessonRecording(
			mode, (blob) => blobs.push(blob), (message) => notices.push(message), dependencies
		)
	};
}

test('mixes both sources, retains trailing chunk, and releases all tracks once', async () => {
	const f = fixture();
	const session = await f.start('meeting');
	assert.deepEqual(f.captureOrder, ['tab', 'mic']);
	assert.equal(f.inputs.length, 2);
	f.recorder.chunk('英語と日本語 ');
	session.stop(); session.stop();
	assert.equal(f.blobs.length, 0);
	await Promise.resolve();
	assert.equal(await f.blobs[0].text(), '英語と日本語 最後の words');
	assert.equal(f.recorder.stops, 1);
	assert.equal(f.closed, 1);
	for (const track of [f.mic, f.tabAudio, f.tabVideo, f.mixedTrack]) assert.equal(track.stops, 1);
});

test('missing shared audio closes the video source without opening microphone', async () => {
	const f = fixture({ noTabAudio: true });
	await assert.rejects(f.start('meeting'), /No tab audio/);
	assert.deepEqual(f.captureOrder, ['tab']);
	assert.equal(f.tabVideo.stops, 1);
});

test('denied microphone releases a previously granted screen share', async () => {
	const f = fixture({ rejectMicrophone: true });
	await assert.rejects(f.start('meeting'), /permission denied/);
	assert.equal(f.tabAudio.stops, 1);
	assert.equal(f.tabVideo.stops, 1);
});

test('ending screen share finalizes rather than silently losing microphone tail', async () => {
	const f = fixture();
	await f.start('meeting');
	f.tabVideo.dispatchEvent(new Event('ended'));
	await Promise.resolve();
	assert.equal(f.blobs.length, 1);
	assert.match(f.notices[0], /source or screen share ended/);
	assert.equal(f.mic.stops, 1);
});

test('memory limit stops once and still retains the final data event', async () => {
	const f = fixture({ maxBytes: 2 });
	await f.start('microphone');
	f.recorder.chunk('abc');
	await Promise.resolve();
	assert.equal(f.inputs.length, 1);
	assert.equal(f.recorder.stops, 1);
	assert.equal(await f.blobs[0].text(), 'abc最後の words');
	assert.match(f.notices[0], /memory limit/);
});
