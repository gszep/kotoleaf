<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { setAuth } from '$lib/stores/auth.svelte';
	import { API_BASE } from '$lib/utils/api';

	let error = $state('');

	onMount(async () => {
		const code = $page.url.searchParams.get('code');
		if (!code) {
			error = 'No authorization code received';
			return;
		}

		try {
			const res = await fetch(`${API_BASE}/auth/callback?code=${encodeURIComponent(code)}`, {
				method: 'POST'
			});

			if (!res.ok) {
				error = 'Authentication failed';
				return;
			}

			const data = await res.json();
			setAuth(data.token, data.user);
			goto('/');
		} catch {
			error = 'Authentication failed';
		}
	});
</script>

<div class="callback">
	{#if error}
		<p class="error">{error}</p>
		<a href="/">Back to home</a>
	{:else}
		<p>Signing in...</p>
	{/if}
</div>

<style>
	.callback {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100vh;
		gap: 1rem;
		color: #666;
	}

	.error {
		color: #ef4444;
	}
</style>
