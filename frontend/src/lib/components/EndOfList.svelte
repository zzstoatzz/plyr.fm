<script lang="ts">
	import { fade } from "svelte/transition";

	interface Props {
		message?: string;
	}

	let { message = "you've reached the end!" }: Props = $props();

	const count = 16;
	const ghostCount = 12; // trailing ghosts per dot
</script>

<div class="end-of-list" in:fade={{ duration: 400 }}>
	<div class="canvas">
		{#each Array(count) as _, i}
			{#each Array(ghostCount) as _, g}
				<i
					style="--i:{i}; --g:{g}"
					class:ghost={g > 0}
				></i>
			{/each}
		{/each}
		<!-- second wave: 1/3 phase offset -->
		{#each Array(count) as _, i}
			{#each Array(ghostCount) as _, g}
				<i
					style="--i:{i}; --g:{g}"
					class:ghost={g > 0}
					class="phase2"
				></i>
			{/each}
		{/each}
		<!-- third wave: 2/3 phase offset -->
		{#each Array(count) as _, i}
			{#each Array(ghostCount) as _, g}
				<i
					style="--i:{i}; --g:{g}"
					class:ghost={g > 0}
					class="phase3"
				></i>
			{/each}
		{/each}
	</div>
	<p class="message">{message}</p>
</div>

<style>
	.end-of-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem 1rem;
		margin-top: 1rem;
	}

	.canvas {
		position: relative;
		width: 100px;
		height: 32px;
	}

	i {
		--wave-color: var(--accent);
		position: absolute;
		left: calc(var(--i) * 6px);
		top: 50%;
		width: 2px;
		height: 2px;
		background: var(--wave-color);
		border-radius: 50%;
		opacity: 0.6;
		box-shadow: 0 0 2px var(--wave-color);
		animation: drift 2s ease-in-out infinite;
		/* base delay for wave + ghost offset for trail */
		animation-delay: calc((var(--i) * -0.15s) + (var(--g) * 0.07s));
	}

	i.ghost {
		opacity: calc(0.35 - (var(--g) * 0.025));
		width: 1px;
		height: 1px;
		border-radius: 50%;
		filter: blur(calc(var(--g) * 0.2px));
		box-shadow: none;
	}

	@keyframes drift {
		0%,
		100% {
			transform: translateY(8px);
		}
		50% {
			transform: translateY(-8px);
		}
	}

	/* 2s duration, so 0.667s = 1/3 phase, 1.333s = 2/3 phase */
	/* each wave gets a color variation mixed from the accent */
	i.phase2 {
		--wave-color: color-mix(in oklch, var(--accent) 70%, #fff);
		animation-delay: calc(
			(var(--i) * -0.15s) + (var(--g) * 0.07s) - 0.667s
		);
	}

	i.phase3 {
		--wave-color: color-mix(in oklch, var(--accent) 60%, #000);
		animation-delay: calc(
			(var(--i) * -0.15s) + (var(--g) * 0.07s) - 1.333s
		);
	}

	.message {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		letter-spacing: 0.02em;
	}

	@media (prefers-reduced-motion: reduce) {
		i {
			animation: none;
			opacity: 0.5;
		}
	}
</style>
