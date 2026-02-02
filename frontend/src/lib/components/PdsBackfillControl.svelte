<script lang="ts">
	import PdsMigrationModal from './PdsMigrationModal.svelte';
	import { API_URL, PDS_AUDIO_UPLOADS_FLAG } from '$lib/config';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { Track } from '$lib/types';

	let {
		tracks,
		onComplete
	}: {
		tracks: Track[];
		onComplete?: () => void | Promise<void>;
	} = $props();

	let showModal = $state(false);
	let migrating = $state(false);

	let hasFlag = $derived(auth.user?.enabled_flags?.includes(PDS_AUDIO_UPLOADS_FLAG) ?? false);

	let backfillableTrackCount = $derived(
		tracks.filter(
			(track) =>
				!track.support_gate &&
				(track.audio_storage ?? 'r2') !== 'both'
		).length
	);

	async function handleMigrate(trackIds: number[]) {
		migrating = true;
		const count = trackIds.length;
		const toastId = toast.info(`migrating ${count} track${count !== 1 ? 's' : ''}...`, 0);

		try {
			const res = await fetch(`${API_URL}/pds-backfill/audio`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ track_ids: trackIds })
			});

			if (!res.ok) {
				migrating = false;
				toast.dismiss(toastId);
				toast.error('failed to start migration');
				return;
			}

			const data = await res.json();
			listenToProgress(data.backfill_id, toastId);
		} catch {
			migrating = false;
			toast.dismiss(toastId);
			toast.error('failed to start migration');
		}
	}

	function listenToProgress(backfillId: string, toastId: string) {
		const eventSource = new EventSource(`${API_URL}/pds-backfill/${backfillId}/progress`);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.processed_count != null && data.total_count) {
					toast.update(toastId, `migrating... ${data.processed_count}/${data.total_count}`);
				}

				if (data.status === 'completed') {
					eventSource.close();
					migrating = false;
					toast.dismiss(toastId);
					const parts: string[] = [];
					if (data.backfilled_count) parts.push(`${data.backfilled_count} migrated`);
					if (data.skipped_count) parts.push(`${data.skipped_count} skipped`);
					if (data.failed_count) parts.push(`${data.failed_count} failed`);
					toast.success(parts.join(', ') || 'migration complete');
					onComplete?.();
				}

				if (data.status === 'failed') {
					eventSource.close();
					migrating = false;
					toast.dismiss(toastId);
					toast.error(data.error || 'migration failed');
				}
			} catch {
				/* ignore parse errors */
			}
		};

		eventSource.onerror = () => {
			eventSource.close();
			migrating = false;
			toast.dismiss(toastId);
			toast.error('migration connection lost');
		};
	}
</script>

{#if hasFlag && backfillableTrackCount > 0}
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
			disabled={migrating}
		>
			{migrating ? 'migrating...' : 'choose tracks'}
		</button>
	</div>
{/if}

{#if showModal}
	<PdsMigrationModal
		{tracks}
		bind:open={showModal}
		onClose={() => (showModal = false)}
		onMigrate={handleMigrate}
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

	.migrate-trigger-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.migrate-trigger-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
