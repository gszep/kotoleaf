export type LessonMode = 'microphone' | 'meeting';

type Dependencies = {
	devices: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
	createContext: () => AudioContext;
	Recorder: typeof MediaRecorder;
	maxBytes?: number;
};

export async function startLessonRecording(
	mode: LessonMode,
	onComplete: (audio: Blob) => void,
	onNotice: (message: string) => void,
	dependencies?: Dependencies
): Promise<{ stop: () => void }> {
	const deps = dependencies ?? {
		devices: navigator.mediaDevices,
		createContext: () => new AudioContext(),
		Recorder: MediaRecorder
	};
	const streams: MediaStream[] = [];
	let context: AudioContext | undefined;
	const cleanup = () => {
		for (const stream of streams) for (const track of stream.getTracks()) track.stop();
		void context?.close().catch(() => {});
	};
	try {
		// The picker must run directly from the click, before another permission await.
		if (mode === 'meeting') {
			const tab = await deps.devices.getDisplayMedia({ video: true, audio: true });
			streams.push(tab);
			if (!tab.getAudioTracks().length) {
				throw new Error('No tab audio was shared. Select the Meet tab and enable Share tab audio.');
			}
		}
		const microphone = await deps.devices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true }, video: false
		});
		streams.push(microphone);
		if (!microphone.getAudioTracks().length) throw new Error('No microphone audio is available.');
		context = deps.createContext();
		await context.resume();
		const destination = context.createMediaStreamDestination();
		for (const stream of streams) {
			const source = context.createMediaStreamSource(stream);
			const gain = context.createGain();
			gain.gain.value = streams.length > 1 ? 0.7 : 1;
			source.connect(gain);
			gain.connect(destination);
		}
		// Only audio reaches the recorder. Nothing connects to the speakers.
		streams.push(destination.stream);
		const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
			.find((type) => deps.Recorder.isTypeSupported(type));
		const recorder = new deps.Recorder(destination.stream, mimeType ? { mimeType } : undefined);
		const chunks: Blob[] = [];
		let bytes = 0;
		let stopped = false;
		let finished = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			if (recorder.state !== 'inactive') recorder.stop();
		};
		recorder.ondataavailable = (event) => {
			if (event.data.size) {
				chunks.push(event.data);
				bytes += event.data.size;
			}
			if (!stopped && bytes >= (deps.maxBytes ?? 128 * 1024 * 1024)) {
				onNotice('Recording reached the memory limit. Save this part before starting another.');
				stop();
			}
		};
		recorder.onerror = () => {
			onNotice('The recorder encountered an error. Save any recovered audio and check it before continuing.');
			stop();
		};
		recorder.onstop = () => {
			if (finished) return;
			finished = true;
			// onstop follows the last dataavailable event: retain the final words.
			const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
			cleanup();
			onComplete(audio);
		};
		recorder.start(1000);
		for (const stream of streams.slice(0, -1)) {
			for (const track of stream.getTracks()) {
				track.addEventListener('ended', () => {
					if (!stopped) {
						onNotice('An audio source or screen share ended. Save and check the recorded part.');
						stop();
					}
				}, { once: true });
			}
		}
		return { stop };
	} catch (error) {
		cleanup();
		throw error;
	}
}
