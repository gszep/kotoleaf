<script lang="ts">
	import SummaryLine from './SummaryLine.svelte';
	import KanjiAssist from './KanjiAssist.svelte';
	import { getLatestSummaryId, type Summary } from '$lib/stores/session.svelte';

	interface Props {
		summaries: Summary[];
	}

	let { summaries }: Props = $props();
	let jpContainer: HTMLElement | null = $state(null);
	let enContainer: HTMLElement | null = $state(null);

	let latestId = $derived(getLatestSummaryId());
	let latestTermPairs = $derived(
		summaries.length > 0 ? summaries[summaries.length - 1].term_pairs : []
	);
</script>

<div class="portrait-solo">
	<div class="half jp-half" bind:this={jpContainer}>
		{#each summaries as summary (summary.summary_id)}
			<SummaryLine html={summary.jp_html} isNew={summary.summary_id === latestId} termPairs={summary.term_pairs} />
		{/each}
		<KanjiAssist containerElement={jpContainer} termPairs={latestTermPairs} />
	</div>

	<div class="divider"></div>

	<div class="half en-half" bind:this={enContainer}>
		{#each summaries as summary (summary.summary_id)}
			<SummaryLine html={summary.en_html} isNew={summary.summary_id === latestId} termPairs={summary.term_pairs} />
		{/each}
		<KanjiAssist containerElement={enContainer} termPairs={latestTermPairs} />
	</div>
</div>

<style>
	.portrait-solo {
		display: flex;
		flex-direction: column;
		height: 100%;
		font-size: 1.1rem;
	}

	.half {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.divider {
		height: 2px;
		background: #e0e0e0;
		flex-shrink: 0;
	}
</style>
