<script lang="ts">
	import { onMount } from 'svelte';
	import { API_BASE } from '$lib/utils/api';

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
