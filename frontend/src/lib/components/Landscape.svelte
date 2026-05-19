<script lang="ts">
	import SummaryLine from './SummaryLine.svelte';
	import KanjiAssist from './KanjiAssist.svelte';
	import type { Summary } from '$lib/stores/session.svelte';

	interface Props {
		summaries: Summary[];
	}

	let { summaries }: Props = $props();
	let enContainer: HTMLElement | null = $state(null);
	let jpContainer: HTMLElement | null = $state(null);

	let latestTermPairs = $derived(
		summaries.length > 0 ? summaries[summaries.length - 1].term_pairs : []
	);
</script>

<div class="landscape">
	<div class="column en-column" bind:this={enContainer}>
		<h2>English</h2>
		{#each summaries as summary (summary.summary_id)}
			<SummaryLine html={summary.en_html} isNew={summary.is_new} termPairs={summary.term_pairs} />
		{/each}
		<KanjiAssist containerElement={enContainer} termPairs={latestTermPairs} />
	</div>

	<div class="divider"></div>

	<div class="column jp-column" bind:this={jpContainer}>
		<h2>日本語</h2>
		{#each summaries as summary (summary.summary_id)}
			<SummaryLine html={summary.jp_html} isNew={summary.is_new} termPairs={summary.term_pairs} />
		{/each}
		<KanjiAssist containerElement={jpContainer} termPairs={latestTermPairs} />
	</div>
</div>

<style>
	.landscape {
		display: flex;
		flex-direction: row;
		height: 100%;
		font-size: 1rem;
	}

	.column {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.column h2 {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 0.5rem 0;
	}

	.divider {
		width: 2px;
		background: #e0e0e0;
		flex-shrink: 0;
	}
</style>
