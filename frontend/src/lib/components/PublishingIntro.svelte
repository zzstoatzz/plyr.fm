<script lang="ts">
	import { HINTS, hintSeen, markHintSeen } from '$lib/hints.svelte';
	import { preferences } from '$lib/preferences.svelte';
	const visible = $derived(preferences.data !== null && !hintSeen(HINTS.publishing));
</script>

{#if visible}
	<aside>
		<p>
			you control who can listen and download. set defaults in <a href="/portal/manage#music-access"
				>Portal</a
			>, then change them for any track or album.
		</p>
		<button type="button" onclick={() => void markHintSeen(HINTS.publishing)}>got it</button>
	</aside>
{/if}

<style>
	aside {
		display: flex;
		align-items: start;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		margin-bottom: 1rem;
	}
	p {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--text-secondary);
	}
	a,
	button {
		color: var(--accent);
	}
	button {
		flex-shrink: 0;
		background: none;
		border: 0;
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 0;
	}
</style>
