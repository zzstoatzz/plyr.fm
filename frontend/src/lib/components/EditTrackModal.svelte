<script lang="ts">
	import { onMount } from 'svelte';
	import type { AlbumSummary, Track } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { checkAtprotofansEligibility } from '$lib/utils/atprotofans';
	import { queue } from '$lib/queue.svelte';
	import { player } from '$lib/player.svelte';
	import { tracksCache } from '$lib/tracks.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import DeleteTrackDialog from './DeleteTrackDialog.svelte';
	import TrackEditForm from './TrackEditForm.svelte';

	interface Props {
		track: Track;
		albums?: AlbumSummary[];
		atprotofansEligible?: boolean;
		onClose: () => void;
		onSaved: (track: Track) => void | Promise<void>;
		/** shows a delete button in the header; called after the track is gone */
		onDeleted?: (trackId: number) => void | Promise<void>;
	}
	let { track, albums, atprotofansEligible, onClose, onSaved, onDeleted }: Props = $props();
	let deleteOpen = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let loadedAlbums = $state<AlbumSummary[]>([]);
	let eligible = $state(false);
	let busy = $state(false);
	let dirty = $state(false);
	let discardOpen = $state(false);
	let closing = $state(false);
	let closeTimer: ReturnType<typeof setTimeout>;
	const titleId = $props.id();

	onMount(() => {
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.showModal();
		dialog?.querySelector('input')?.focus();
		const abort = new AbortController();
		if (albums === undefined) {
			void fetch(`${API_URL}/albums/${encodeURIComponent(track.artist_handle)}`, {
				credentials: 'include',
				signal: abort.signal
			})
				.then(async (response) => {
					if (response.ok) {
						const result: { albums: AlbumSummary[] } = await response.json();
						loadedAlbums = result.albums;
					}
				})
				.catch(() => {});
		}
		if (atprotofansEligible === undefined) {
			void checkAtprotofansEligibility(track.artist_did).then((value) => {
				eligible = value;
			});
		}
		return () => {
			abort.abort();
			clearTimeout(closeTimer);
			dialog?.close();
			document.body.style.overflow = previousOverflow;
		};
	});

	function close() {
		if (closing) return;
		closing = true;
		const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: parseFloat(
					window.getComputedStyle(document.documentElement).getPropertyValue('--motion-exit')
				);
		closeTimer = setTimeout(() => {
			dialog?.close();
			onClose();
		}, duration);
	}

	function requestClose() {
		if (busy) return;
		if (dirty) discardOpen = true;
		else close();
	}

	async function updateTrack(updated: Track) {
		queue.updateTrackMetadata(updated);
		if (player.currentTrack?.id === updated.id)
			player.currentTrack = { ...player.currentTrack, ...updated };
		tracksCache.invalidate();
		await onSaved(updated);
	}

	async function saved(updated: Track) {
		await updateTrack(updated);
		dirty = false;
		close();
	}
</script>

<dialog
	bind:this={dialog}
	class:closing
	aria-labelledby={titleId}
	oncancel={(event) => {
		event.preventDefault();
		requestClose();
	}}
	onkeydown={(event) => event.stopPropagation()}
	onclick={(event) => {
		if (event.target === dialog) requestClose();
	}}
>
	<div class="editor">
		<header>
			<div class="heading">
				<h2 id={titleId}>edit track</h2>
				{#if track.atproto_record_uri?.startsWith('at://')}
					<a
						class="record-link"
						href={`https://pds.ls/at/${track.atproto_record_uri.slice(5)}`}
						target="_blank"
						rel="noopener noreferrer">view record on pds.ls</a
					>
				{/if}
			</div>
			<div class="header-actions">
				{#if onDeleted}
					<button
						class="icon-button delete-button"
						type="button"
						aria-label="delete track"
						title="delete track"
						disabled={busy}
						onclick={() => (deleteOpen = true)}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<polyline points="3 6 5 6 21 6"></polyline>
							<path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"
							></path>
							<path d="M10 11v6"></path>
							<path d="M14 11v6"></path>
							<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
						</svg>
					</button>
				{/if}
				<button
					class="icon-button close-button"
					type="button"
					aria-label="close edit track"
					disabled={busy}
					onclick={requestClose}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg
					>
				</button>
			</div>
		</header>
		<TrackEditForm
			{track}
			albums={albums ?? loadedAlbums}
			atprotofansEligible={atprotofansEligible ?? eligible}
			onClose={requestClose}
			onSaved={saved}
			onTrackChanged={updateTrack}
			onBusyChange={(value) => {
				busy = value;
			}}
			onDirtyChange={(value) => {
				dirty = value;
			}}
		/>
	</div>
</dialog>

<ConfirmDialog
	bind:open={discardOpen}
	title="discard changes?"
	body="your unsaved track details will be lost."
	confirmText="discard changes"
	cancelText="keep editing"
	variant="danger"
	onConfirm={() => {
		discardOpen = false;
		close();
	}}
	onCancel={() => {
		discardOpen = false;
	}}
/>

{#if onDeleted}
	<DeleteTrackDialog
		bind:open={deleteOpen}
		{track}
		onDeleted={async (trackId) => {
			// the track no longer exists, so there is nothing to save or discard
			dirty = false;
			dialog?.close();
			onClose();
			await onDeleted(trackId);
		}}
	/>
{/if}

<style>
	dialog {
		padding: 0;
		width: min(640px, calc(100vw - 32px));
		max-width: none;
		max-height: calc(100dvh - 48px);
		margin: auto;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		background: var(--bg-secondary);
		color: var(--text-primary);
		overflow: hidden;
	}
	dialog[open] {
		animation: editor-enter var(--motion-enter) var(--ease-surface) both;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 60%);
		animation: backdrop-enter var(--motion-enter) var(--ease-surface) both;
	}
	dialog.closing {
		animation: editor-leave var(--motion-exit) ease-in both;
	}
	dialog.closing::backdrop {
		animation: backdrop-enter var(--motion-exit) ease-in reverse both;
	}
	.editor {
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - 48px);
	}
	.editor > :global(.edit-container) {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 24px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.heading {
		min-width: 0;
	}
	.record-link {
		display: inline-block;
		padding-block: 4px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		text-underline-offset: 3px;
	}
	.record-link:hover {
		color: var(--text-primary);
	}
	.record-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.icon-button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background 140ms,
			transform 140ms;
	}
	.icon-button:hover {
		background: var(--bg-hover);
	}
	.delete-button:hover {
		color: var(--error);
	}
	.icon-button:active {
		transform: scale(0.94);
	}
	.icon-button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.icon-button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	@keyframes editor-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes editor-leave {
		to {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	@keyframes backdrop-enter {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@media (max-width: 600px) {
		dialog {
			width: 100%;
			max-height: calc(100dvh - 12px);
			margin: auto 0 0;
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		}
		.editor {
			max-height: calc(100dvh - 12px);
			padding-bottom: env(safe-area-inset-bottom);
		}
		header {
			padding-inline: 16px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open],
		dialog.closing,
		dialog::backdrop,
		dialog.closing::backdrop {
			animation: none;
		}
		.icon-button {
			transition: none;
		}
	}
</style>
