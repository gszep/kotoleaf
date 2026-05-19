<script lang="ts">
	import { getTermColor } from '$lib/utils/color-palette';

	interface Props {
		containerElement: HTMLElement | null;
		termPairs: Array<{ index: number; color?: string }>;
	}

	let { containerElement, termPairs }: Props = $props();

	$effect(() => {
		if (!containerElement) return;

		for (const pair of termPairs) {
			const color = pair.color || getTermColor(pair.index);
			const spans = containerElement.querySelectorAll(
				`[data-pair-index="${pair.index}"]`
			);
			for (const span of spans) {
				(span as HTMLElement).style.color = color;
				(span as HTMLElement).style.borderBottomColor = color;
			}
		}
	});
</script>
