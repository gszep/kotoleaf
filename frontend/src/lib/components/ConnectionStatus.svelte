<script lang="ts">
	import { getConnectionState } from '$lib/stores/session.svelte';

	const STATE_LABELS: Record<string, string> = {
		disconnected: 'Disconnected',
		connecting: 'Connecting...',
		listening: 'Listening',
		processing: 'Processing...',
		error: 'Error'
	};

	const STATE_COLORS: Record<string, string> = {
		disconnected: '#999',
		connecting: '#f59e0b',
		listening: '#22c55e',
		processing: '#3b82f6',
		error: '#ef4444'
	};

	let state = $derived(getConnectionState());
</script>

<div class="connection-status" style:--dot-color={STATE_COLORS[state] || '#999'}>
	<span class="dot"></span>
	<span class="label">{STATE_LABELS[state] || state}</span>
</div>

<style>
	.connection-status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #666;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--dot-color);
	}
</style>
