<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
		message?: string;
	}

	let { size = 'md', message }: Props = $props();

	// size configurations
	const configs = {
		sm: { barWidth: 3, barHeight: 16, gap: 4 },
		md: { barWidth: 4, barHeight: 24, gap: 6 },
		lg: { barWidth: 6, barHeight: 32, gap: 8 }
	};

	const config = configs[size];
	const numBars = 5;
</script>

<div class="wave-loading">
	<div class="bars" style:--bar-width="{config.barWidth}px" style:--bar-height="{config.barHeight}px" style:--gap="{config.gap}px">
		{#each Array(numBars) as _, i}
			<div class="bar" style:--delay="{i * 0.1}s"></div>
		{/each}
	</div>
	{#if message}
		<p class="message">{message}</p>
	{/if}
</div>

<style>
	.wave-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.bars {
		display: flex;
		align-items: center;
		gap: var(--gap);
		height: var(--bar-height);
	}

	.bar {
		width: var(--bar-width);
		height: 100%;
		background: var(--accent);
		border-radius: calc(var(--bar-width) / 2);
		animation: wave 1.2s ease-in-out infinite;
		animation-delay: var(--delay);
		opacity: 0.8;
	}

	@keyframes wave {
		0%, 100% {
			transform: scaleY(0.3);
			opacity: 0.5;
		}
		50% {
			transform: scaleY(1);
			opacity: 1;
		}
	}

	.message {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-base);
		text-align: center;
	}
</style>
