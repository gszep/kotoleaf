<script lang="ts">
	interface Props {
		html: string;
		isNew: boolean;
		termPairs: Array<{ index: number; color?: string }>;
	}

	let { html, isNew, termPairs }: Props = $props();
</script>

<div class="summary-line" class:is-new={isNew} class:is-old={!isNew}>
	{@html html}
</div>

<style>
	.summary-line {
		padding: 0.5rem 0;
		line-height: 1.6;
		transition: opacity 0.3s ease;
	}

	.is-new {
		opacity: 1;
		font-weight: 500;
	}

	.is-old {
		opacity: 0.4;
	}

	.summary-line :global(ruby) {
		ruby-position: over;
	}

	.summary-line :global(rt) {
		font-size: 0.6em;
		color: #666;
	}

	.summary-line :global(.term-pair) {
		font-weight: 600;
		border-bottom: 2px solid currentColor;
		padding-bottom: 1px;
	}
</style>
