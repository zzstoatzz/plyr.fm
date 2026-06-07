<script lang="ts">
	import type { RadioStation } from '$lib/radio.svelte';

	let {
		stations,
		activeSlug,
		onSelect
	}: {
		stations: RadioStation[];
		activeSlug: string | null;
		onSelect: (slug: string) => void;
	} = $props();
</script>

{#if stations.length > 1}
	<div class="dial" role="tablist" aria-label="radio stations">
		<div class="line" aria-hidden="true"></div>
		<div class="stops">
			{#each stations as s (s.slug)}
				<button
					type="button"
					role="tab"
					aria-selected={s.slug === activeSlug}
					class="stop"
					class:active={s.slug === activeSlug}
					title={s.description}
					onclick={() => onSelect(s.slug)}
				>
					<span class="tick" aria-hidden="true"></span>
					<span class="name">{s.name}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.dial {
		position: relative;
		width: min(100%, 30rem);
		align-self: center;
		padding-top: 0.4rem;
	}

	/* the frequency line behind the stops */
	.line {
		position: absolute;
		top: 0.55rem;
		left: 0.5rem;
		right: 0.5rem;
		height: 2px;
		background: var(--border-default);
		border-radius: 999px;
	}

	.stops {
		position: relative;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.stop {
		appearance: none;
		background: none;
		border: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0 0.25rem;
		cursor: pointer;
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-sm);
		text-transform: lowercase;
		-webkit-tap-highlight-color: transparent;
		transition: color 0.15s ease;
	}

	/* inactive stop: a short flat tick on the line. active: a tall accent "needle"
	   that rises above the line with a glowing tip (a tuner pointer, not a dot) */
	.tick {
		width: 2px;
		height: 0.5rem;
		border-radius: 2px;
		background: var(--border-default);
		transition:
			height 0.18s ease,
			margin-top 0.18s ease,
			background 0.18s ease,
			box-shadow 0.18s ease;
	}

	.stop:hover {
		color: var(--text-secondary);
	}

	.stop:hover .tick {
		background: var(--text-tertiary);
	}

	.stop.active {
		color: var(--accent);
		font-weight: 600;
	}

	.stop.active .tick {
		height: 1.15rem;
		margin-top: -0.32rem;
		background: var(--accent);
		box-shadow: 0 0 7px 1px color-mix(in srgb, var(--accent) 65%, transparent);
	}
</style>
