<script lang="ts">
	import PdsAudioUploadsToggle from '$lib/components/PdsAudioUploadsToggle.svelte';
	import PdsBackfillControl from '$lib/components/PdsBackfillControl.svelte';
	import type { Track } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';

	let {
		tracks,
		tracksTotal,
		loadMyTracks
	}: {
		tracks: Track[];
		tracksTotal: number;
		loadMyTracks: () => void | Promise<void>;
	} = $props();

	let exportingMedia = $state(false);

	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let deleteAtprotoRecords = $state(false);
	let deleting = $state(false);

	async function exportAllMedia() {
		if (exportingMedia) return;

		const trackCount = tracksTotal || tracks.length;
		const exportMsg = trackCount === 1 ? 'preparing export of your track...' : `preparing export of ${trackCount} tracks...`;

		// 0 means infinite/persist until dismissed
		const toastId = toast.info(exportMsg, 0);

		exportingMedia = true;
		try {
			// start the export
			const response = await fetch(`${API_URL}/exports/media`, {
				method: 'POST',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to start export');
				exportingMedia = false;
				return;
			}

			const result = await response.json();
			const exportId = result.export_id;

			// subscribe to progress updates via SSE
			const eventSource = new EventSource(`${API_URL}/exports/${exportId}/progress`);
			let exportComplete = false;

			eventSource.onmessage = async (event) => {
				const update = JSON.parse(event.data);

				// show progress messages
				if (update.message && update.status === 'processing') {
					toast.update(toastId, update.message);
				}

				if (update.status === 'completed') {
					exportComplete = true;
					eventSource.close();
					exportingMedia = false;

					// update toast to show download is starting
					toast.update(toastId, 'download starting...');

					if (update.download_url) {
						// Trigger download directly from R2
						const a = document.createElement('a');
						a.href = update.download_url;
						a.download = `plyr-tracks-${new Date().toISOString().split('T')[0]}.zip`;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);

						toast.dismiss(toastId);
						toast.success(`${update.processed_count || trackCount} ${trackCount === 1 ? 'track' : 'tracks'} exported successfully`);
					} else {
						toast.dismiss(toastId);
						toast.error('export completed but download url missing');
					}
				}

				if (update.status === 'failed') {
					exportComplete = true;
					eventSource.close();
					toast.dismiss(toastId);
					exportingMedia = false;

					const errorMsg = update.error || 'export failed';
					toast.error(errorMsg);
				}
			};

			eventSource.onerror = () => {
				eventSource.close();
				// Don't show error if export already completed - SSE stream closing is normal
				if (exportComplete) return;
				toast.dismiss(toastId);
				exportingMedia = false;
				toast.error('lost connection to server');
			};

		} catch (e) {
			console.error('export failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to start export');
			exportingMedia = false;
		}
	}

	async function deleteAccount() {
		if (!auth.user || deleteConfirmText !== auth.user.handle) return;

		deleting = true;
		const toastId = toast.info('deleting account...', 0);

		try {
			const response = await fetch(`${API_URL}/account/`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					confirmation: deleteConfirmText,
					delete_atproto_records: deleteAtprotoRecords
				})
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to delete account');
				deleting = false;
				return;
			}

			const result = await response.json();
			toast.dismiss(toastId);

			const { deleted } = result;
			const summary = [
				deleted.tracks && `${deleted.tracks} tracks`,
				deleted.albums && `${deleted.albums} albums`,
				deleted.likes && `${deleted.likes} likes`,
				deleted.comments && `${deleted.comments} comments`,
				deleted.atproto_records && `${deleted.atproto_records} ATProto records`
			].filter(Boolean).join(', ');

			toast.success(`account deleted: ${summary || 'all data removed'}`);

			setTimeout(() => {
				window.location.href = '/';
			}, 2000);

		} catch (e) {
			console.error('delete failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to delete account');
			deleting = false;
		}
	}
</script>

<section class="data-section">
	<div class="section-header">
		<h2>your data</h2>
		<a href="/settings" class="settings-link">all settings →</a>
	</div>

	{#if tracksTotal > 0}
		<div class="data-control">
			<PdsAudioUploadsToggle />
		</div>
		<PdsBackfillControl tracks={tracks} onComplete={loadMyTracks} />

		<div class="data-control">
			<div class="control-info">
				<h3>export tracks</h3>
				<p class="control-description">
					{tracksTotal === 1 ? 'download your track as a zip archive' : `download all ${tracksTotal} tracks as a zip archive`}
				</p>
			</div>
			<button
				class="export-btn"
				onclick={exportAllMedia}
				disabled={exportingMedia}
			>
				{exportingMedia ? 'exporting...' : 'export'}
			</button>
		</div>
	{/if}

	<div class="data-control danger-zone">
		<div class="control-info">
			<h3>delete account</h3>
			<p class="control-description">
				permanently delete all your data from plyr.fm.
				<a href="https://docs.plyr.fm/artists#leaving" target="_blank" rel="noopener">learn more</a>
			</p>
		</div>
		{#if !showDeleteConfirm}
			<button
				class="delete-account-btn"
				onclick={() => showDeleteConfirm = true}
			>
				delete account
			</button>
		{:else}
			<div class="delete-confirm-panel">
				<p class="delete-warning">
					this will permanently delete all your tracks, albums, likes, and comments from plyr.fm. this cannot be undone.
				</p>

				<div class="atproto-section">
					<label class="atproto-option">
						<input type="checkbox" bind:checked={deleteAtprotoRecords} />
						<span>also delete records from my ATProto repo</span>
					</label>
					<p class="atproto-note">
						you can manage your PDS records directly via <a href="https://pdsls.dev/at://{auth.user?.did}" target="_blank" rel="noopener">pdsls.dev</a>, or let us clean them up for you.
					</p>
					{#if deleteAtprotoRecords}
						<p class="atproto-warning">
							this removes track, like, and comment records from your PDS. other users' likes and comments that reference your tracks will become orphaned.
						</p>
					{/if}
				</div>

				<p class="confirm-prompt">
					type <strong>{auth.user?.handle}</strong> to confirm:
				</p>
				<input
					type="text"
					class="confirm-input"
					bind:value={deleteConfirmText}
					placeholder={auth.user?.handle}
					disabled={deleting}
				/>

				<div class="delete-actions">
					<button
						class="cancel-delete-btn"
						onclick={() => {
							showDeleteConfirm = false;
							deleteConfirmText = '';
							deleteAtprotoRecords = false;
						}}
						disabled={deleting}
					>
						cancel
					</button>
					<button
						class="confirm-delete-btn"
						onclick={deleteAccount}
						disabled={deleting || deleteConfirmText !== auth.user?.handle}
					>
						{deleting ? 'deleting...' : 'delete everything'}
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	/* shared page-level primitives — duplicated here because Svelte scoped CSS
	   does not cross the component boundary; the parent keeps its own copies for
	   the remaining sections. */
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.4rem;
		font-size: var(--text-sm);
	}

	input[type='text'] {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* your data section */
	.data-section {
		margin-top: 2.5rem;
	}

	.data-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1rem;
	}

	.settings-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.settings-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

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

	.data-control:last-child {
		margin-bottom: 0;
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
		line-height: 1.4;
	}

	.export-btn {
		padding: 0.6rem 1.25rem; background: var(--accent); color: var(--bg-primary);
		border: none; border-radius: var(--radius-base); font-family: inherit;
		font-size: var(--text-base); font-weight: 600; cursor: pointer;
		transition: all 0.2s; white-space: nowrap; width: auto;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	/* danger zone / account deletion */
	.danger-zone {
		border-color: color-mix(in srgb, var(--error) 30%, transparent);
		flex-direction: column;
		align-items: stretch;
	}

	.danger-zone .control-info h3 {
		color: var(--error);
	}

	.danger-zone .control-description a {
		color: var(--text-tertiary);
	}

	.danger-zone .control-description a:hover {
		color: var(--text-secondary);
	}

	.delete-account-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		color: var(--error);
		border: 1px solid var(--error);
		border-radius: var(--radius-base);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		align-self: flex-end;
	}

	.delete-account-btn:hover {
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.delete-confirm-panel {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}

	.delete-warning {
		margin: 0 0 1rem;
		color: var(--error);
		font-size: var(--text-base);
		line-height: 1.5;
	}

	.atproto-section {
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-base);
	}

	.atproto-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-base);
		color: var(--text-primary);
		cursor: pointer;
	}

	.atproto-option input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}

	.atproto-note {
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.atproto-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.atproto-note a:hover {
		text-decoration: underline;
	}

	.atproto-warning {
		margin: 0.5rem 0 0;
		padding: 0.5rem;
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--warning);
	}

	.confirm-prompt {
		margin: 0 0 0.5rem;
		font-size: var(--text-base);
		color: var(--text-secondary);
	}

	.confirm-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		margin-bottom: 1rem;
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.delete-actions {
		display: flex;
		gap: 0.75rem;
	}

	.cancel-delete-btn {
		flex: 1;
		padding: 0.6rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-delete-btn:hover:not(:disabled) {
		border-color: var(--text-secondary);
	}

	.cancel-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-delete-btn {
		flex: 1;
		padding: 0.6rem;
		background: var(--error);
		border: none;
		border-radius: var(--radius-base);
		color: white;
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.confirm-delete-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.confirm-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 600px) {
		.data-section h2 {
			font-size: var(--text-xl);
		}

		.section-header {
			margin-bottom: 0.75rem;
		}

		label {
			font-size: var(--text-sm);
			margin-bottom: 0.3rem;
		}

		input[type='text'] {
			padding: 0.5rem 0.6rem;
			font-size: var(--text-base);
		}

		.data-section {
			margin-top: 2rem;
		}

		.data-control {
			padding: 0.85rem 1rem;
			gap: 0.6rem;
		}

		.control-info h3 {
			font-size: var(--text-sm);
		}

		.control-description {
			font-size: var(--text-xs);
		}

		.export-btn {
			padding: 0.5rem 0.85rem;
			font-size: var(--text-sm);
		}
	}
</style>
