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

	let backfilling = $state(false);

	let backfillableTrackCount = $derived(
		tracks.filter(
			(track) =>
				!track.support_gate &&
				(track.audio_storage ?? 'r2') !== 'both'
		).length
	);

	async function backfillAudioToPds() {
		if (backfilling) return;
		if (backfillableTrackCount === 0) {
			toast.info('all your tracks already have PDS blobs');
			return;
		}

		const toastId = toast.info(`backfilling ${backfillableTrackCount} tracks...`, 0);
		backfilling = true;

		try {
			const response = await fetch(`${API_URL}/pds-backfill/audio`, {
				method: 'POST',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to start backfill');
				backfilling = false;
				return;
			}

			const result = await response.json();
			const backfillId = result.backfill_id;

			const eventSource = new EventSource(`${API_URL}/pds-backfill/${backfillId}/progress`);
			let backfillComplete = false;

			eventSource.onmessage = async (event) => {
				const update = JSON.parse(event.data);

				if (update.message && update.status === 'processing') {
					const progressDetail = update.backfilled_count !== undefined
						? ` (${update.backfilled_count}/${update.total_count})`
						: '';
					toast.update(toastId, `${update.message}${progressDetail}`);
				}

				if (update.status === 'completed') {
					backfillComplete = true;
					eventSource.close();
					backfilling = false;
					await onComplete?.();
					toast.dismiss(toastId);
					toast.success('backfill completed');
				}

				if (update.status === 'failed') {
					backfillComplete = true;
					eventSource.close();
					backfilling = false;
					const errorMsg = update.error || 'backfill failed';
					toast.dismiss(toastId);
					toast.error(errorMsg);
				}
			};

			eventSource.onerror = () => {
				if (backfillComplete) return;
				eventSource.close();
				backfilling = false;
				toast.dismiss(toastId);
				toast.error('backfill connection lost');
			};
		} catch (e) {
			console.error('backfill failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to start backfill');
			backfilling = false;
		}
	}
</script>

{#if backfillableTrackCount > 0}
	<div class="data-control">
		<div class="control-info">
			<h3>backfill audio to your PDS</h3>
			<p class="control-description">
				{backfillableTrackCount === 1
					? 'copy your audio blob to your PDS and keep the CDN fallback'
					: `copy ${backfillableTrackCount} audio blobs to your PDS and keep the CDN fallback`}
			</p>
		</div>
		<button
			class="backfill-btn"
			onclick={backfillAudioToPds}
			disabled={backfilling}
		>
			{backfilling ? 'backfilling...' : 'backfill'}
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

	.backfill-btn {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-md);
		padding: 0.5rem 1rem;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.backfill-btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.backfill-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 700px) {
		.data-control {
			flex-direction: column;
			align-items: stretch;
		}

		.backfill-btn {
			width: 100%;
		}
	}
</style>
