export class ScreenShareCapture {
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private processor: ScriptProcessorNode | null = null;
	private onAudioData: ((data: ArrayBuffer) => void) | null = null;

	async start(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
		this.onAudioData = onAudioData;

		// Chrome-only: capture tab audio via getDisplayMedia
		this.stream = await navigator.mediaDevices.getDisplayMedia({
			audio: true,
			video: true // required by Chrome to show tab picker
		});

		const audioTracks = this.stream.getAudioTracks();
		if (audioTracks.length === 0) {
			this.stop();
			throw new Error('No audio track captured. Make sure to check "Share tab audio".');
		}

		this.audioContext = new AudioContext({ sampleRate: 16000 });
		const source = this.audioContext.createMediaStreamSource(
			new MediaStream(audioTracks)
		);

		this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
		this.processor.onaudioprocess = (event) => {
			const inputData = event.inputBuffer.getChannelData(0);
			const pcm16 = this.float32ToPcm16(inputData);
			this.onAudioData?.(pcm16.buffer as ArrayBuffer);
		};

		source.connect(this.processor);
		this.processor.connect(this.audioContext.destination);
	}

	stop(): void {
		this.processor?.disconnect();
		this.stream?.getTracks().forEach((t) => t.stop());
		this.audioContext?.close();
		this.processor = null;
		this.stream = null;
		this.audioContext = null;
	}

	private float32ToPcm16(float32: Float32Array): Int16Array {
		const pcm16 = new Int16Array(float32.length);
		for (let i = 0; i < float32.length; i++) {
			const s = Math.max(-1, Math.min(1, float32[i]));
			pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
		}
		return pcm16;
	}
}
