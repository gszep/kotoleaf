import { getToken } from '$lib/stores/auth.svelte';
import {
	addSummary,
	addTranscriptEntry,
	setConnectionState,
	type Summary
} from '$lib/stores/session.svelte';
import { getTermColor } from '$lib/utils/color-palette';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

export class KotoleafSocket {
	private ws: WebSocket | null = null;
	private sessionId: string;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	connect(): void {
		setConnectionState('connecting');
		this.ws = new WebSocket(`${WS_BASE}/sessions/ws/${this.sessionId}`);
		this.ws.binaryType = 'arraybuffer';

		this.ws.onopen = () => {
			const token = getToken();
			this.ws!.send(
				JSON.stringify({
					type: 'start_session',
					token
				})
			);
		};

		this.ws.onmessage = (event) => {
			if (typeof event.data === 'string') {
				this.handleMessage(JSON.parse(event.data));
			}
		};

		this.ws.onclose = () => {
			setConnectionState('disconnected');
		};

		this.ws.onerror = () => {
			setConnectionState('error');
		};
	}

	sendAudio(pcmData: ArrayBuffer): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(pcmData);
		}
	}

	updateRegister(register: string): void {
		this.sendJson({ type: 'update_register', register });
	}

	updateThresholds(config: Record<string, number>): void {
		this.sendJson({ type: 'update_thresholds', config });
	}

	endSession(): void {
		this.sendJson({ type: 'end_session' });
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	private sendJson(data: object): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private handleMessage(msg: Record<string, unknown>): void {
		switch (msg.type) {
			case 'status':
				setConnectionState(msg.state as 'listening' | 'processing');
				break;

			case 'transcript': {
				const tag = msg.is_final ? 'FINAL' : 'interim';
				console.log(`[${tag}] [${msg.speaker}] ${msg.text}`);
				addTranscriptEntry({
					text: msg.text as string,
					speaker: msg.speaker as string,
					is_final: msg.is_final as boolean
				});
				break;
			}

			case 'summary': {
				const termPairs = (msg.term_pairs as Array<Record<string, unknown>>).map(
					(tp, i: number) => ({
						...tp,
						color: getTermColor(tp.index as number)
					})
				);
				addSummary({
					summary_id: msg.summary_id as string,
					en_html: msg.en_html as string,
					jp_html: msg.jp_html as string,
					is_new: msg.is_new as boolean,
					term_pairs: termPairs as Summary['term_pairs']
				});
				break;
			}

			case 'error':
				console.error('Server error:', msg.message);
				setConnectionState('error');
				break;
		}
	}
}
