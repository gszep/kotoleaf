import { AudioCapture } from './capture';

export class MicrophoneCapture extends AudioCapture {
	protected async acquireStream(): Promise<MediaStream> {
		return navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				sampleRate: 16000,
				echoCancellation: true,
				noiseSuppression: true
			}
		});
	}
}
