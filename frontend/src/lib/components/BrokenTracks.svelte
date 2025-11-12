<script lang="ts">
	import { onMount } from 'svelte';
	import LoadingSpinner from './LoadingSpinner.svelte';
	import { toast } from '$lib/toast.svelte';
	import { API_URL } from '$lib/config';
	import type { Track } from '$lib/types';

	let brokenTracks = $state<Track[]>([]);
	let loading = $state(true);
	let restoringTrackId = $state<number | null>(null);

	onMount(async () => {
		await loadBrokenTracks();
	});

	async function loadBrokenTracks() {
		loading = true;
		const sessionId = localStorage.getItem('session_id');
		try {
			const response = await fetch(`${API_URL}/tracks/me/broken`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
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
		const sessionId = localStorage.getItem('session_id');

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}/restore-record`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				const data = await response.json();
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
</script>

{#if loading}
	<div class="loading-container">
		<LoadingSpinner size="md" />
	</div>
{:else if brokenTracks.length > 0}
	<section class="broken-tracks-section">
		<div class="section-header">
			<h2>tracks needing attention</h2>
			<span class="count-badge">{brokenTracks.length}</span>
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
						disabled={restoringTrackId === track.id}
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
		background: rgba(255, 152, 0, 0.05);
		border: 1px solid rgba(255, 152, 0, 0.2);
		border-radius: 8px;
		padding: 1.5rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		font-size: 1.5rem;
		margin: 0;
		color: #ff9800;
	}

	.count-badge {
		background: rgba(255, 152, 0, 0.2);
		color: #ff9800;
		padding: 0.25rem 0.6rem;
		border-radius: 12px;
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
		background: #1a1a1a;
		border: 1px solid rgba(255, 152, 0, 0.3);
		border-radius: 6px;
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
		color: #fff;
	}

	.track-meta {
		font-size: 0.9rem;
		color: #aaa;
		margin-bottom: 0.5rem;
	}

	.issue-description {
		font-size: 0.85rem;
		color: #ff9800;
	}

	.restore-btn {
		padding: 0.5rem 1rem;
		background: rgba(255, 152, 0, 0.15);
		border: 1px solid rgba(255, 152, 0, 0.4);
		border-radius: 4px;
		color: #ff9800;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.restore-btn:hover:not(:disabled) {
		background: rgba(255, 152, 0, 0.25);
		border-color: #ff9800;
		transform: translateY(-1px);
	}

	.restore-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.info-box {
		background: #0a0a0a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		padding: 1rem;
		font-size: 0.9rem;
		color: #aaa;
	}

	.info-box strong {
		display: block;
		color: #ff9800;
		margin-bottom: 0.5rem;
	}

	.info-box p {
		margin: 0;
		line-height: 1.5;
	}

	@media (max-width: 768px) {
		.broken-track-item {
			flex-direction: column;
			align-items: stretch;
		}

		.restore-btn {
			width: 100%;
		}
	}
</style>
