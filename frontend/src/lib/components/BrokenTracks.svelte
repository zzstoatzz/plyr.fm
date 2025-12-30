<script lang="ts">
	import { onMount } from 'svelte';
	import WaveLoading from './WaveLoading.svelte';
	import { toast } from '$lib/toast.svelte';
	import { API_URL } from '$lib/config';
	import type { Track } from '$lib/types';

	let brokenTracks = $state<Track[]>([]);
	let loading = $state(true);
	let restoringTrackId = $state<number | null>(null);
	let restoringAll = $state(false);

	onMount(async () => {
		await loadBrokenTracks();
	});

	async function loadBrokenTracks() {
		loading = true;
		try {
			const response = await fetch(`${API_URL}/tracks/me/broken`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				brokenTracks = data.tracks || [];
			} else {
				console.error('failed to load broken tracks:', response.status);
			}
		} catch (e) {
			console.error('error loading broken tracks:', e);
		} finally {
			loading = false;
		}
	}

	async function restoreRecord(trackId: number, trackTitle: string) {
		if (!confirm(`restore ATProto record for "${trackTitle}"?\n\nthis will create a new record on your PDS with the original timestamp.`)) {
			return;
		}

		restoringTrackId = trackId;

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}/restore-record`, {
				method: 'POST',
				credentials: 'include'
			});

			if (response.ok) {
				await response.json();
				toast.success(`restored record for ${trackTitle}`);
				// remove from broken tracks list
				brokenTracks = brokenTracks.filter(t => t.id !== trackId);
			} else if (response.status === 409) {
				const error = await response.json();
				if (error.detail?.error === 'migration_needed') {
					toast.error('this track needs migration - check migration banner above');
				} else {
					toast.error(error.detail?.message || 'restore failed');
				}
			} else if (response.status === 400) {
				const error = await response.json();
				toast.error(error.detail?.message || 'track already has a record');
				// reload to refresh state
				await loadBrokenTracks();
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to restore record');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			restoringTrackId = null;
		}
	}

	async function restoreAll() {
		if (!confirm(`restore all ${brokenTracks.length} tracks?\n\nthis will create new records on your PDS with the original timestamps.`)) {
			return;
		}

		restoringAll = true;
		const trackCount = brokenTracks.length;

		try {
			const results = await Promise.allSettled(
				brokenTracks.map(track =>
					fetch(`${API_URL}/tracks/${track.id}/restore-record`, {
						method: 'POST',
						credentials: 'include'
					}).then(async response => {
						if (!response.ok) {
							let errorMsg = `failed to restore ${track.title}`;
							try {
								const errorData = await response.json();
								if (errorData.detail?.error === 'migration_needed') {
									errorMsg = `${track.title} needs migration`;
								} else if (errorData.detail?.error === 'already_has_record') {
									errorMsg = `${track.title} already has a record`;
								} else if (errorData.detail) {
									errorMsg = `${track.title}: ${errorData.detail}`;
								}
							} catch {
								// use default errorMsg if JSON parsing fails
							}
							throw new Error(errorMsg);
						}
						return track;
					})
				)
			);

			const successful = results.filter(r => r.status === 'fulfilled').length;
			const failed = results.filter(r => r.status === 'rejected').length;

			if (successful > 0) {
				const trackWord = trackCount === 1 ? 'track' : 'tracks';
			toast.success(`restored ${successful} of ${trackCount} ${trackWord}`);
				// reload to refresh state
				await loadBrokenTracks();
			}
			if (failed > 0) {
				const failedWord = failed === 1 ? 'track' : 'tracks';
			toast.error(`failed to restore ${failed} ${failedWord}`);
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			restoringAll = false;
		}
	}
</script>

{#if loading}
	<div class="loading-container">
		<WaveLoading size="md" />
	</div>
{:else if brokenTracks.length > 0}
	<section class="broken-tracks-section">
		<div class="section-header">
			<div class="header-left">
				<h2>tracks needing attention</h2>
				<span class="count-badge">{brokenTracks.length}</span>
			</div>
			<button
				class="restore-all-btn"
				onclick={restoreAll}
				disabled={restoringAll}
			>
				{restoringAll ? 'restoring all...' : 'restore all'}
			</button>
		</div>
		<div class="broken-tracks-list">
			{#each brokenTracks as track}
				<div class="broken-track-item">
					<div class="track-info">
						<div class="warning-icon">⚠️</div>
						<div class="track-details">
							<div class="track-title">{track.title}</div>
							<div class="track-meta">{track.artist}</div>
							<div class="issue-description">
								missing ATProto record - this track cannot be liked until restored
							</div>
						</div>
					</div>
					<button
						class="restore-btn"
						onclick={() => restoreRecord(track.id, track.title)}
						disabled={restoringTrackId === track.id || restoringAll}
					>
						{restoringTrackId === track.id ? 'restoring...' : 'restore record'}
					</button>
				</div>
			{/each}
		</div>
		<div class="info-box">
			<strong>what does this mean?</strong>
			<p>
				these tracks are missing their ATProto records, which means they can't be liked by other users.
				clicking "restore record" will recreate the record on your PDS with the original timestamp.
			</p>
		</div>
	</section>
{/if}

<style>
	.loading-container {
		display: flex;
		justify-content: center;
		padding: 2rem;
	}

	.broken-tracks-section {
		margin-bottom: 3rem;
		background: color-mix(in srgb, var(--warning) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 20%, transparent);
		border-radius: var(--radius-md);
		padding: 1.5rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.section-header h2 {
		font-size: 1.5rem;
		margin: 0;
		color: var(--warning);
	}

	.restore-all-btn {
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--warning) 20%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 50%, transparent);
		border-radius: var(--radius-sm);
		color: var(--warning);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.restore-all-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--warning) 30%, transparent);
		border-color: var(--warning);
		transform: translateY(-1px);
	}

	.restore-all-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.count-badge {
		background: color-mix(in srgb, var(--warning) 20%, transparent);
		color: var(--warning);
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-lg);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.broken-tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.broken-track-item {
		background: var(--bg-tertiary);
		border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
		border-radius: var(--radius-base);
		padding: 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.track-info {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.warning-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.track-details {
		flex: 1;
		min-width: 0;
	}

	.track-title {
		font-weight: 600;
		font-size: 1rem;
		margin-bottom: 0.25rem;
		color: var(--text-primary);
	}

	.track-meta {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.issue-description {
		font-size: 0.85rem;
		color: var(--warning);
	}

	.restore-btn {
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--warning) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
		border-radius: var(--radius-sm);
		color: var(--warning);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.restore-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--warning) 25%, transparent);
		border-color: var(--warning);
		transform: translateY(-1px);
	}

	.restore-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.info-box {
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-base);
		padding: 1rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.info-box strong {
		display: block;
		color: var(--warning);
		margin-bottom: 0.5rem;
	}

	.info-box p {
		margin: 0;
		line-height: 1.5;
	}

	@media (max-width: 768px) {
		.section-header {
			flex-direction: column;
			align-items: stretch;
		}

		.header-left {
			justify-content: space-between;
		}

		.restore-all-btn {
			width: 100%;
		}

		.broken-track-item {
			flex-direction: column;
			align-items: stretch;
		}

		.restore-btn {
			width: 100%;
		}
	}
</style>
