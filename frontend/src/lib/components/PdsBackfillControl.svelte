<script lang="ts">
	import PdsMigrationModal from './PdsMigrationModal.svelte';
	import type { Track } from '$lib/types';

	let {
		tracks,
		onComplete
	}: {
		tracks: Track[];
		onComplete?: () => void | Promise<void>;
	} = $props();

	let showModal = $state(false);

	let backfillableTrackCount = $derived(
		tracks.filter(
			(track) =>
				!track.support_gate &&
				(track.audio_storage ?? 'r2') !== 'both'
		).length
	);
</script>

{#if backfillableTrackCount > 0}
	<div class="data-control">
		<div class="control-info">
			<h3>migrate audio to your PDS</h3>
			<p class="control-description">
				{backfillableTrackCount === 1
					? 'copy your audio blob to your PDS and keep the CDN fallback'
					: `copy ${backfillableTrackCount} audio blobs to your PDS and keep the CDN fallback`}
			</p>
		</div>
		<button
			class="migrate-trigger-btn"
			onclick={() => (showModal = true)}
		>
			choose tracks
		</button>
	</div>
{/if}

{#if showModal}
	<PdsMigrationModal
		{tracks}
		bind:open={showModal}
		onClose={() => (showModal = false)}
		{onComplete}
	/>
{/if}

<style>
	.data-control {
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.control-info {
		flex: 1;
		min-width: 0;
	}

	.control-info h3 {
		font-size: var(--text-base);
		font-weight: 600;
		margin: 0 0 0.15rem 0;
		color: var(--text-primary);
	}

	.control-description {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		margin: 0;
	}

	.migrate-trigger-btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-base);
		padding: 0.6rem 1.25rem;
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.migrate-trigger-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	@media (max-width: 700px) {
		.data-control {
			flex-direction: column;
			align-items: stretch;
		}

		.migrate-trigger-btn {
			width: 100%;
			text-align: center;
		}
	}
</style>
