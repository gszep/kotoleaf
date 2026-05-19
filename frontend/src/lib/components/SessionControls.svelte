<script lang="ts">
	import ConnectionStatus from './ConnectionStatus.svelte';
	import SpeakerList from './SpeakerList.svelte';
	import {
		getRegister,
		setRegister,
		getDisplayMode,
		setDisplayMode,
		getAudioSource,
		setAudioSource,
		type Register,
		type DisplayMode
	} from '$lib/stores/settings.svelte';

	interface Props {
		onStart: () => void;
		onStop: () => void;
		onRegisterChange: (register: Register) => void;
		onRenameSpeaker: (speakerId: string, name: string) => void;
		isActive: boolean;
	}

	let { onStart, onStop, onRegisterChange, onRenameSpeaker, isActive }: Props = $props();

	let currentRegister = $derived(getRegister());
	let currentMode = $derived(getDisplayMode());
	let currentSource = $derived(getAudioSource());

	function handleRegisterChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value as Register;
		setRegister(value);
		onRegisterChange(value);
	}

	function handleModeChange(e: Event) {
		setDisplayMode((e.target as HTMLSelectElement).value as DisplayMode);
	}

	function handleSourceChange(e: Event) {
		setAudioSource((e.target as HTMLSelectElement).value as 'microphone' | 'screen_share');
	}
</script>

<div class="controls">
	<div class="controls-row">
		<ConnectionStatus />

		{#if !isActive}
			<button class="btn-start" onclick={onStart}>Start Session</button>
		{:else}
			<button class="btn-stop" onclick={onStop}>End Session</button>
		{/if}
	</div>

	<div class="controls-row">
		<label>
			Register
			<select value={currentRegister} onchange={handleRegisterChange}>
				<option value="workplace_polite">Workplace Polite</option>
				<option value="formal">Formal</option>
				<option value="casual">Casual</option>
			</select>
		</label>

		<label>
			Display
			<select value={currentMode} onchange={handleModeChange}>
				<option value="portrait-shared">Shared (flip)</option>
				<option value="portrait-solo">Solo</option>
				<option value="landscape">Landscape</option>
			</select>
		</label>

		<label>
			Audio
			<select value={currentSource} onchange={handleSourceChange}>
				<option value="microphone">Microphone</option>
				<option value="screen_share">Screen Share</option>
			</select>
		</label>

		<SpeakerList {onRenameSpeaker} />
	</div>
</div>

<style>
	.controls {
		padding: 0.75rem 1rem;
		background: #f8f8f8;
		border-bottom: 1px solid #e0e0e0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.controls-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: #666;
	}

	select {
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}

	.btn-start {
		padding: 0.4rem 1rem;
		background: #22c55e;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		margin-left: auto;
	}

	.btn-stop {
		padding: 0.4rem 1rem;
		background: #ef4444;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		margin-left: auto;
	}
</style>
