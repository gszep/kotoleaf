<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { getToken } from '$lib/stores/auth.svelte';
	import {
		getSummaries,
		getConnectionState,
		clearSession
	} from '$lib/stores/session.svelte';
	import {
		getDisplayMode,
		getAudioSource,
		type Register
	} from '$lib/stores/settings.svelte';
	import { KotoleafSocket } from '$lib/ws/client';
	import { MicrophoneCapture } from '$lib/audio/microphone';
	import { ScreenShareCapture } from '$lib/audio/screen-share';
	import SessionControls from '$lib/components/SessionControls.svelte';
	import RatingPrompt from '$lib/components/RatingPrompt.svelte';
	import PortraitShared from '$lib/components/PortraitShared.svelte';
	import PortraitSolo from '$lib/components/PortraitSolo.svelte';
	import Landscape from '$lib/components/Landscape.svelte';
	import { API_BASE } from '$lib/utils/api';

	let socket: KotoleafSocket | null = null;
	let mic: MicrophoneCapture | null = null;
	let screenShare: ScreenShareCapture | null = null;
	let isActive = $state(false);
	let showRating = $state(false);

	let sessionId = $derived($page.params.id);
	let summaries = $derived(getSummaries());
	let displayMode = $derived(getDisplayMode());

	async function startSession() {
		clearSession();

		socket = new KotoleafSocket(sessionId);
		socket.connect();

		const audioSource = getAudioSource();
		if (audioSource === 'screen_share') {
			screenShare = new ScreenShareCapture();
			await screenShare.start((data) => socket?.sendAudio(data));
		} else {
			mic = new MicrophoneCapture();
			await mic.start((data) => socket?.sendAudio(data));
		}

		isActive = true;
	}

	function stopSession() {
		socket?.endSession();
		mic?.stop();
		screenShare?.stop();
		socket?.disconnect();
		mic = null;
		screenShare = null;
		socket = null;
		isActive = false;
		showRating = true;
	}

	async function handleRate(rating: number) {
		showRating = false;
		try {
			await fetch(`${API_BASE}/sessions/${sessionId}/rate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${getToken()}`
				},
				body: JSON.stringify({ rating })
			});
		} catch {
			// rating save is best-effort
		}
	}

	function handleRegisterChange(register: Register) {
		socket?.updateRegister(register);
	}

	onDestroy(() => {
		mic?.stop();
		screenShare?.stop();
		socket?.disconnect();
	});
</script>

<div class="session-page">
	<SessionControls
		{isActive}
		onStart={startSession}
		onStop={stopSession}
		onRegisterChange={handleRegisterChange}
	/>

	<div class="display-area">
		{#if displayMode === 'portrait-shared'}
			<PortraitShared {summaries} />
		{:else if displayMode === 'portrait-solo'}
			<PortraitSolo {summaries} />
		{:else}
			<Landscape {summaries} />
		{/if}
	</div>
</div>

{#if showRating}
	<RatingPrompt onRate={handleRate} />
{/if}

<style>
	.session-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	.display-area {
		flex: 1;
		overflow: hidden;
	}
</style>
