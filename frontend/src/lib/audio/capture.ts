export abstract class AudioCapture {
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private processor: ScriptProcessorNode | null = null;
	private onAudioData: ((data: ArrayBuffer) => void) | null = null;

	protected abstract acquireStream(): Promise<MediaStream>;

	protected extractAudioStream(stream: MediaStream): MediaStream {
		return stream;
	}

	async start(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
		this.onAudioData = onAudioData;

		this.stream = await this.acquireStream();
		const audioStream = this.extractAudioStream(this.stream);

		this.audioContext = new AudioContext({ sampleRate: 16000 });
		const source = this.audioContext.createMediaStreamSource(audioStream);

		this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
		this.processor.onaudioprocess = (event) => {
			const inputData = event.inputBuffer.getChannelData(0);
			const pcm16 = float32ToPcm16(inputData);
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
}

function float32ToPcm16(float32: Float32Array): Int16Array {
	const pcm16 = new Int16Array(float32.length);
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i]));
		pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return pcm16;
}
