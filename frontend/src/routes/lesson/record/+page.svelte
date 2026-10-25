<script lang="ts">
	import { onDestroy } from 'svelte';
	import { startLessonRecording, type LessonMode } from '$lib/audio/lesson-recorder';

	let mode = $state<LessonMode>('microphone');
	let status = $state<'idle' | 'starting' | 'recording' | 'finishing' | 'saved'>('idle');
	let notice = $state('');
	let audioUrl = $state('');
	let filename = $state('');
	let elapsed = $state(0);
	let downloaded = $state(false);
	let recording: { stop: () => void } | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let disposed = false;
	const busy = $derived(status === 'starting' || status === 'recording' || status === 'finishing');

	async function start() {
		if (busy || (audioUrl && !downloaded)) return;
		if (audioUrl) URL.revokeObjectURL(audioUrl);
		audioUrl = '';
		notice = '';
		downloaded = false;
		elapsed = 0;
		status = 'starting';
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		try {
			recording = await startLessonRecording(mode, (blob) => {
				if (disposed) return;
				clearInterval(timer);
				recording = undefined;
				status = 'saved';
				if (!blob.size) {
					notice = 'No audio was recovered. Record a short test before the lesson.';
					return;
				}
				audioUrl = URL.createObjectURL(blob);
				const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
				filename = `kotoleaf-lesson-${stamp}.${extension}`;
			}, (message) => { notice = message; });
			if (disposed) {
				recording.stop();
				return;
			}
			status = 'recording';
			const startedAt = Date.now();
			timer = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); }, 1000);
		} catch (error) {
			status = 'idle';
			notice = error instanceof Error ? error.message : 'Could not start recording.';
		}
	}

	function stop() {
		status = 'finishing';
		recording?.stop();
	}

	function beforeUnload(event: BeforeUnloadEvent) {
		if (busy || (audioUrl && !downloaded)) {
			event.preventDefault();
			event.returnValue = '';
		}
	}

	onDestroy(() => {
		disposed = true;
		clearInterval(timer);
		recording?.stop();
		if (audioUrl) URL.revokeObjectURL(audioUrl);
	});
</script>

<svelte:head><title>Record a lesson · Kotoleaf</title></svelte:head>
<svelte:window onbeforeunload={beforeUnload} />

<main>
	<h1>Record a lesson <span lang="ja">レッスンを録音</span></h1>
	<p>Save the original conversation for English/Japanese transcription and vocabulary review.</p>
	<label for="source">Audio source</label>
	<select id="source" bind:value={mode} disabled={busy}>
		<option value="microphone">In person — microphone</option>
		<option value="meeting">Google Meet — shared tab + microphone</option>
	</select>
	{#if mode === 'meeting'}
		<p>Select the Meet tab and enable <strong>Share tab audio</strong>. Your microphone is captured separately.
			Use headphones to reduce duplicate voices and echo.</p>
	{:else}
		<p>Place the microphone where it can hear both you and your teacher.</p>
	{/if}
	<p>First record a short test with both speakers and play it back. This page needs localhost or HTTPS.</p>
	<div class="controls">
		<button onclick={start} disabled={busy || (!!audioUrl && !downloaded)}>Start recording</button>
		<button onclick={stop} disabled={status !== 'recording'}>Stop and prepare download</button>
	</div>
	<p aria-live="polite">{status === 'saved' ? 'Recording stopped — download below' : status}
		· {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
	{#if notice}<p role="alert">{notice}</p>{/if}
	{#if audioUrl}
		<audio controls src={audioUrl} aria-label="Review recorded lesson"></audio>
		<a class="download" href={audioUrl} download={filename}>Download original audio</a>
		<label class="confirmed"><input type="checkbox" bind:checked={downloaded} />
			I have checked that the downloaded file was saved.</label>
		<p>Keep this original file. The Kotoleaf recorded-lesson command can create a timestamped bilingual
			transcript; recording here does not automatically upload or transcribe it.</p>
	{/if}
	<p class="note">Audio stays in this browser's memory until you download it. Keep this tab open and the
		device awake. The recorder stops at approximately 128 MiB; save that part before continuing.</p>
</main>

<style>
	main { max-width: 44rem; margin: 3rem auto; padding: 1.5rem; line-height: 1.6; }
	h1 { font-size: 1.8rem; }
	h1 span { display: block; font-size: 1.2rem; }
	select, button { font: inherit; padding: .65rem; border: 1px solid #888; border-radius: .4rem; }
	select { display: block; width: 100%; margin: .5rem 0; }
	.controls { display: flex; flex-wrap: wrap; gap: .75rem; }
	button:not(:disabled), .download { cursor: pointer; }
	audio { display: block; width: 100%; margin: 1rem 0; }
	.download { display: inline-block; margin-bottom: 1rem; }
	.confirmed { display: block; }
	.note { opacity: .75; font-size: .9rem; }
</style>
