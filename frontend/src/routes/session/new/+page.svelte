<script lang="ts">
	import { goto } from '$app/navigation';
	import { getToken } from '$lib/stores/auth.svelte';
	import { API_BASE } from '$lib/utils/api';

	let register = $state('workplace_polite');
	let audioSource = $state('microphone');
	let creating = $state(false);

	async function createSession() {
		creating = true;
		try {
			const res = await fetch(`${API_BASE}/sessions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${getToken()}`
				},
				body: JSON.stringify({
					register,
					audio_source: audioSource
				})
			});

			if (!res.ok) throw new Error('Failed to create session');

			const session = await res.json();
			goto(`/session/${session.id}`);
		} catch {
			creating = false;
		}
	}
</script>

<div class="new-session">
	<h1>New Session</h1>

	<form onsubmit={(e) => { e.preventDefault(); createSession(); }}>
		<label>
			Register
			<select bind:value={register}>
				<option value="workplace_polite">Workplace Polite (default)</option>
				<option value="formal">Formal</option>
				<option value="casual">Casual</option>
			</select>
		</label>

		<label>
			Audio Source
			<select bind:value={audioSource}>
				<option value="microphone">Microphone (in-person)</option>
				<option value="screen_share">Screen Share (Google Meet)</option>
			</select>
		</label>

		<button type="submit" disabled={creating}>
			{creating ? 'Creating...' : 'Start Session'}
		</button>
	</form>

	<a href="/" class="back">Back</a>
</div>

<style>
	.new-session {
		max-width: 400px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 400;
		margin: 0 0 1.5rem 0;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: #666;
	}

	select {
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-size: 1rem;
	}

	button {
		padding: 0.75rem;
		background: #1a1a1a;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.back {
		display: block;
		margin-top: 1rem;
		color: #888;
		font-size: 0.85rem;
	}
</style>
