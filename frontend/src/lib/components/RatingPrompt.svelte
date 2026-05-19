<script lang="ts">
	interface Props {
		onRate: (rating: number) => void;
	}

	let { onRate }: Props = $props();
	let hoveredStar = $state(0);
</script>

<div class="rating-overlay">
	<div class="rating-card">
		<h3>How was this session?</h3>
		<div class="stars">
			{#each [1, 2, 3, 4, 5] as star}
				<button
					class="star"
					class:filled={star <= hoveredStar}
					onmouseenter={() => (hoveredStar = star)}
					onmouseleave={() => (hoveredStar = 0)}
					onclick={() => onRate(star)}
				>
					&#9733;
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.rating-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.rating-card {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		text-align: center;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
	}

	.rating-card h3 {
		margin: 0 0 1rem 0;
		font-size: 1.2rem;
	}

	.stars {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	.star {
		font-size: 2rem;
		background: none;
		border: none;
		cursor: pointer;
		color: #ddd;
		transition: color 0.15s;
	}

	.star.filled {
		color: #f59e0b;
	}
</style>
