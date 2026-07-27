<script lang="ts">
	import {
		fetchLuminframeImageAsFile,
		listLuminframeImages,
		type LuminframeImage
	} from '$lib/utils/luminframe';

	interface Props {
		/** the signed-in user's DID — whose repo to list images from. */
		did: string;
		/** called with the chosen image wrapped as a File, ready for upload. */
		onSelect: (file: File) => void;
		disabled?: boolean;
	}

	let { did, onSelect, disabled = false }: Props = $props();

	let dialogEl = $state<HTMLDialogElement>();
	let open = $state(false);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let images = $state<LuminframeImage[]>([]);
	// uri of the image currently being downloaded, so only its tile spins
	let fetchingUri = $state<string | null>(null);

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});

	async function load() {
		loading = true;
		error = null;
		try {
			images = await listLuminframeImages(did);
			loaded = true;
		} catch (e) {
			console.error('failed to load luminframe images:', e);
			error = 'could not load images from your PDS';
		} finally {
			loading = false;
		}
	}

	function openPicker() {
		open = true;
		if (!loaded && !loading) load();
	}

	function requestClose() {
		if (fetchingUri) return;
		open = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		// clicking the ::backdrop dispatches a click whose target is the <dialog>
		if (event.target === dialogEl) requestClose();
	}

	async function pick(image: LuminframeImage) {
		if (fetchingUri) return;
		fetchingUri = image.uri;
		error = null;
		try {
			const file = await fetchLuminframeImageAsFile(image);
			onSelect(file);
			open = false;
		} catch (e) {
			console.error('failed to fetch luminframe image:', e);
			error = 'could not fetch that image — try another or retry';
		} finally {
			fetchingUri = null;
		}
	}
</script>

<button type="button" class="luminframe-btn" {disabled} onclick={openPicker}>
	choose from luminframe
</button>

<dialog
	bind:this={dialogEl}
	class="luminframe-dialog"
	aria-label="choose a luminframe image"
	onclose={requestClose}
	onclick={handleBackdropClick}
>
	<div class="modal-header">
		<h3>your luminframe images</h3>
		<button type="button" class="close-btn" onclick={requestClose} aria-label="close">
			&times;
		</button>
	</div>
	<div class="modal-body">
		{#if loading}
			<p class="state-note">loading images from your PDS...</p>
		{:else if error}
			<p class="state-note error">{error}</p>
			<button type="button" class="retry-btn" onclick={load}>retry</button>
		{:else if images.length === 0}
			<p class="state-note">
				no luminframe images in your repo yet — make some at
				<a href="https://luminframe.com" target="_blank" rel="noopener">luminframe.com</a>
			</p>
		{:else}
			<div class="image-grid">
				{#each images as image (image.uri)}
					<button
						type="button"
						class="image-tile"
						class:fetching={fetchingUri === image.uri}
						disabled={fetchingUri !== null}
						onclick={() => pick(image)}
						title={image.title ?? image.alt ?? 'luminframe image'}
					>
						<img src={image.imageUrl} alt={image.alt ?? image.title ?? ''} loading="lazy" />
						{#if fetchingUri === image.uri}
							<span class="tile-overlay">fetching...</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</dialog>

<style>
	.luminframe-btn,
	.retry-btn {
		padding: 0.5rem 0.875rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.luminframe-btn:hover:not(:disabled),
	.retry-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.luminframe-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.luminframe-dialog {
		background: var(--bg-primary);
		color: inherit;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		padding: 0;
		width: 100%;
		max-width: 560px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.luminframe-dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-header h3 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
		padding: 0.25rem;
	}

	.close-btn:hover {
		color: var(--text-primary);
	}

	.modal-body {
		padding: 1.5rem;
		max-height: 60vh;
		overflow-y: auto;
	}

	.state-note {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-base);
		line-height: 1.5;
	}

	.state-note.error {
		color: var(--error);
		margin-bottom: 0.75rem;
	}

	.state-note a {
		color: var(--accent);
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.image-tile {
		position: relative;
		padding: 0;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		aspect-ratio: 1;
		overflow: hidden;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.image-tile:hover:not(:disabled),
	.image-tile.fetching {
		border-color: var(--accent);
	}

	.image-tile:disabled:not(.fetching) {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.image-tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.tile-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
		color: white;
		font-size: var(--text-sm);
	}
</style>
