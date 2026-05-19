<script lang="ts">
	import { getSpeakerMap } from '$lib/stores/session.svelte';

	interface Props {
		onRenameSpeaker: (speakerId: string, name: string) => void;
	}

	let { onRenameSpeaker }: Props = $props();
	let speakerMap = $derived(getSpeakerMap());
	let entries = $derived(Object.entries(speakerMap).sort(([a], [b]) => Number(a) - Number(b)));
	let expanded = $state(false);

	function handleRename(speakerId: string, e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value && value !== speakerMap[speakerId]) {
			onRenameSpeaker(speakerId, value);
		}
	}

	function handleKeydown(speakerId: string, e: KeyboardEvent) {
		if (e.key === 'Enter') {
			(e.target as HTMLInputElement).blur();
		}
	}
</script>

{#if entries.length > 0}
	<div class="speaker-list">
		<button class="toggle" onclick={() => (expanded = !expanded)}>
			{expanded ? '▾' : '▸'} Speakers ({entries.length})
		</button>

		{#if expanded}
			<div class="entries">
				{#each entries as [id, name] (id)}
					<div class="entry">
						<span class="id">#{id}</span>
						<input
							type="text"
							value={name}
							onblur={(e) => handleRename(id, e)}
							onkeydown={(e) => handleKeydown(id, e)}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.speaker-list {
		font-size: 0.8rem;
	}

	.toggle {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		color: #666;
		padding: 0;
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-top: 0.3rem;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.id {
		color: #999;
		font-size: 0.75rem;
		min-width: 1.5rem;
	}

	input {
		font-size: 0.8rem;
		padding: 0.15rem 0.3rem;
		border: 1px solid #ddd;
		border-radius: 3px;
		width: 10rem;
	}

	input:focus {
		border-color: #999;
		outline: none;
	}
</style>
