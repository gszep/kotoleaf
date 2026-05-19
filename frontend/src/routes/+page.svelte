<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuth, setAuth } from '$lib/stores/auth.svelte';

	const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

	let backendStatus = $state<'checking' | 'ok' | 'error'>('checking');

	onMount(async () => {
		try {
			const res = await fetch(`${API_BASE}/health`);
			backendStatus = res.ok ? 'ok' : 'error';
		} catch {
			backendStatus = 'error';
		}
	});

	let auth = $derived(getAuth());

	async function devLogin() {
		const res = await fetch(`${API_BASE}/auth/dev-login`, { method: 'POST' });
		if (res.ok) {
			const data = await res.json();
			setAuth(data.token, data.user);
		}
	}
</script>

<div class="landing">
	<header>
		<h1>Kotoleaf <span class="jp">言リーフ</span></h1>
		<p class="tagline">Leaves between our words</p>
	</header>

	<div class="status">
		{#if backendStatus === 'checking'}
			<span class="dot checking"></span> Connecting to server...
		{:else if backendStatus === 'ok'}
			<span class="dot ok"></span> Server connected
		{:else}
			<span class="dot error"></span> Server unavailable
		{/if}
	</div>

	{#if auth.token && auth.user}
		<div class="user-info">
			<p>Signed in as {auth.user.name}</p>
			<a href="/session/new" class="btn-primary">New Session</a>
		</div>
	{:else}
		<button class="btn-primary" onclick={devLogin}>Dev Login</button>
	{/if}
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100vh;
		gap: 1.5rem;
		padding: 2rem;
		text-align: center;
	}

	header h1 {
		font-size: 2.5rem;
		margin: 0;
		font-weight: 300;
	}

	.jp {
		font-size: 1.8rem;
		color: #888;
	}

	.tagline {
		margin: 0.25rem 0 0;
		color: #888;
		font-style: italic;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #666;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.dot.checking {
		background: #f59e0b;
	}
	.dot.ok {
		background: #22c55e;
	}
	.dot.error {
		background: #ef4444;
	}

	.btn-primary {
		display: inline-block;
		padding: 0.75rem 2rem;
		background: #1a1a1a;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-primary:hover {
		background: #333;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.user-info p {
		margin: 0;
		color: #666;
	}
</style>
