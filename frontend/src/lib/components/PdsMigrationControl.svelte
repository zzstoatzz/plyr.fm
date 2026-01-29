<script lang="ts">
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import type { Track } from '$lib/types';

	let {
		tracks,
		onComplete
	}: {
		tracks: Track[];
		onComplete?: () => void | Promise<void>;
	} = $props();

	let migrating = $state(false);

	let migratableTrackCount = $derived(
		tracks.filter(
			(track) =>
				!track.support_gate &&
				(track.audio_storage ?? 'r2') !== 'both'
		).length
	);

	async function migrateAudioToPds() {
		if (migrating) return;
		if (migratableTrackCount === 0) {
			toast.info('all your tracks already have PDS blobs');
			return;
		}

		const toastId = toast.info(`migrating ${migratableTrackCount} tracks...`, 0);
		migrating = true;

		try {
			const response = await fetch(`${API_URL}/pds-migrations/audio`, {
				method: 'POST',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to start migration');
				migrating = false;
				return;
			}

			const result = await response.json();
			const migrationId = result.migration_id;

			const eventSource = new EventSource(`${API_URL}/pds-migrations/${migrationId}/progress`);
			let migrationComplete = false;

			eventSource.onmessage = async (event) => {
				const update = JSON.parse(event.data);

				if (update.message && update.status === 'processing') {
					const progressDetail = update.migrated_count !== undefined
						? ` (${update.migrated_count}/${update.total_count})`
						: '';
					toast.update(toastId, `${update.message}${progressDetail}`);
				}

				if (update.status === 'completed') {
					migrationComplete = true;
					eventSource.close();
					migrating = false;
					await onComplete?.();
					toast.dismiss(toastId);
					toast.success('migration completed');
				}

				if (update.status === 'failed') {
					migrationComplete = true;
					eventSource.close();
					migrating = false;
					const errorMsg = update.error || 'migration failed';
					toast.dismiss(toastId);
					toast.error(errorMsg);
				}
			};

			eventSource.onerror = () => {
				if (migrationComplete) return;
				eventSource.close();
				migrating = false;
				toast.dismiss(toastId);
				toast.error('migration connection lost');
			};
		} catch (e) {
			console.error('migration failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to start migration');
			migrating = false;
		}
	}
</script>

{#if migratableTrackCount > 0}
	<div class="data-control">
		<div class="control-info">
			<h3>migrate audio to your PDS</h3>
			<p class="control-description">
				{migratableTrackCount === 1
					? 'move your audio blob to your PDS and keep the CDN fallback'
					: `move ${migratableTrackCount} audio blobs to your PDS and keep the CDN fallback`}
			</p>
		</div>
		<button
			class="migrate-btn"
			onclick={migrateAudioToPds}
			disabled={migrating}
		>
			{migrating ? 'migrating...' : 'migrate'}
		</button>
	</div>
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

	.migrate-btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		padding: 0.5rem 1rem;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.migrate-btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.migrate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 700px) {
		.data-control {
			flex-direction: column;
			align-items: stretch;
		}

		.migrate-btn {
			width: 100%;
		}
	}
</style>
