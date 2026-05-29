<script lang="ts">
	import PdsSaveModal from './PdsSaveModal.svelte';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import type { Track } from '$lib/types';
	import { isOptimizingInterimWav } from '$lib/utils/track-audio';

	let {
		tracks,
		onComplete
	}: {
		tracks: Track[];
		onComplete?: () => void | Promise<void>;
	} = $props();

	let showModal = $state(false);
	let saving = $state(false);

	let savableTrackCount = $derived(
		tracks.filter(
			(track) =>
				!track.support_gate &&
				(track.audio_storage ?? 'r2') !== 'both' &&
				!isOptimizingInterimWav(track)
		).length
	);

	async function handleSave(trackIds: number[]) {
		saving = true;
		const count = trackIds.length;
		const toastId = toast.info(`saving ${count} track${count !== 1 ? 's' : ''}...`, 0);

		try {
			const res = await fetch(`${API_URL}/pds-save/audio`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ track_ids: trackIds })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => null);
				saving = false;
				toast.dismiss(toastId);
				toast.error(err?.detail || 'failed to start saving');
				return;
			}

			const data = await res.json();
			listenToProgress(data.save_id, toastId);
		} catch {
			saving = false;
			toast.dismiss(toastId);
			toast.error('failed to start saving');
		}
	}

	function listenToProgress(saveId: string, toastId: string) {
		const eventSource = new EventSource(`${API_URL}/pds-save/${saveId}/progress`);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.processed_count != null && data.total_count) {
					toast.update(toastId, `saving... ${data.processed_count}/${data.total_count}`);
				}

				if (data.status === 'completed') {
					eventSource.close();
					saving = false;
					toast.dismiss(toastId);
					const parts: string[] = [];
					if (data.saved_count) parts.push(`${data.saved_count} saved`);
					if (data.skipped_count) parts.push(`${data.skipped_count} skipped`);
					if (data.failed_count) parts.push(`${data.failed_count} failed`);
					toast.success(parts.join(', ') || 'saved to your PDS');
					onComplete?.();
				}

				if (data.status === 'failed') {
					eventSource.close();
					saving = false;
					toast.dismiss(toastId);
					toast.error(data.error || 'save failed');
				}
			} catch {
				/* ignore parse errors */
			}
		};

		eventSource.onerror = () => {
			eventSource.close();
			saving = false;
			toast.dismiss(toastId);
			toast.error('save connection lost');
		};
	}
</script>

{#if savableTrackCount > 0}
	<div class="data-control">
		<div class="control-info">
			<h3>save audio to your PDS</h3>
			<p class="control-description">
				{savableTrackCount === 1
					? 'copy your audio blob to your PDS and keep the CDN fallback'
					: `copy ${savableTrackCount} audio blobs to your PDS and keep the CDN fallback`}
			</p>
		</div>
		<button
			class="save-trigger-btn"
			onclick={() => (showModal = true)}
			disabled={saving}
		>
			{saving ? 'saving...' : 'choose tracks'}
		</button>
	</div>
{/if}

{#if showModal}
	<PdsSaveModal
		{tracks}
		bind:open={showModal}
		onClose={() => (showModal = false)}
		onSave={handleSave}
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

	.save-trigger-btn {
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

	.save-trigger-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.save-trigger-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 700px) {
		.data-control {
			flex-direction: column;
			align-items: stretch;
		}

		.save-trigger-btn {
			width: 100%;
			text-align: center;
		}
	}
</style>
