import { AudioCapture } from './capture';

export class ScreenShareCapture extends AudioCapture {
	protected async acquireStream(): Promise<MediaStream> {
		return navigator.mediaDevices.getDisplayMedia({
			audio: true,
			video: true
		});
	}

	protected extractAudioStream(stream: MediaStream): MediaStream {
		const audioTracks = stream.getAudioTracks();
		if (audioTracks.length === 0) {
			this.stop();
			throw new Error('No audio track captured. Make sure to check "Share tab audio".');
		}
		return new MediaStream(audioTracks);
	}
}
