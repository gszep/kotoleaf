<script lang="ts">
	import { onMount } from 'svelte';

	const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

	onMount(async () => {
		const res = await fetch(`${API_BASE}/auth/login`);
		const data = await res.json();
		window.location.href = data.url;
	});
</script>

<div class="loading">
	<p>Redirecting to Google Sign-In...</p>
</div>

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		color: #666;
	}
</style>
