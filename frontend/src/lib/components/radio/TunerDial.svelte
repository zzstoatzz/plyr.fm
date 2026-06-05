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

	/* the tick sits on the line; active is a lit dot (the needle) */
	.tick {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: var(--bg-primary);
		box-shadow: inset 0 0 0 2px var(--border-default);
		transition:
			background 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	.stop:hover {
		color: var(--text-secondary);
	}

	.stop.active {
		color: var(--accent);
		font-weight: 600;
	}

	.stop.active .tick {
		background: var(--accent);
		box-shadow:
			inset 0 0 0 2px var(--accent),
			0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
		transform: scale(1.15);
	}
</style>
