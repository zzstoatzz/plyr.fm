<script lang="ts">
	import { onMount } from 'svelte';
	import * as albumActions from '$lib/album-actions';
	import { toast } from '$lib/toast.svelte';
	import type { AlbumMetadata, Track } from '$lib/types';
	import AlbumPublishingEditor from './AlbumPublishingEditor.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// album details + settings in one dialog with one save, the same shell as
	// the track editor (centered on desktop, bottom sheet on phones). nothing is
	// written until save: the cover is previewed locally and uploaded on save.
	interface Props {
		album: AlbumMetadata;
		tracks: Track[];
		onClose: () => void;
		/** the album changed on the server; patch local state */
		onSaved: (changes: Partial<Pick<AlbumMetadata, 'title' | 'image_url' | 'show_plylst'>>) => void;
		/** draft plylst choice while open, null once closed, for the live page preview */
		onPlylstPreview?: (enabled: boolean | null) => void;
	}
	let { album, tracks, onClose, onSaved, onPlylstPreview }: Props = $props();

	const titleId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let coverInput = $state<HTMLInputElement>();
	let settings = $state<ReturnType<typeof AlbumPublishingEditor>>();
	let title = $state(album.title);
	let coverFile = $state<File | null>(null);
	let coverPreview = $state<string | null>(null);
	let settingsDirty = $state(false);
	let saving = $state(false);
	let error = $state('');
	let discardOpen = $state(false);
	let closing = $state(false);
	let closeTimer: ReturnType<typeof setTimeout>;

	const titleDirty = $derived(!!title.trim() && title.trim() !== album.title);
	const dirty = $derived(titleDirty || coverFile !== null || settingsDirty);
	const cover = $derived(coverPreview ?? album.image_url ?? null);

	onMount(() => {
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.showModal();
		return () => {
			clearTimeout(closeTimer);
			dialog?.close();
			document.body.style.overflow = previousOverflow;
			if (coverPreview) URL.revokeObjectURL(coverPreview);
			onPlylstPreview?.(null);
		};
	});

	function close() {
		if (closing) return;
		closing = true;
		const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: parseFloat(
					window.getComputedStyle(document.documentElement).getPropertyValue('--motion-exit')
				) || 0;
		closeTimer = setTimeout(() => {
			dialog?.close();
			onClose();
		}, duration);
	}

	function requestClose() {
		if (saving) return;
		if (dirty) discardOpen = true;
		else close();
	}

	function pickCover(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			error = 'please select an image file';
			return;
		}
		if (file.size > 20 * 1024 * 1024) {
			error = 'image must be under 20MB';
			return;
		}
		error = '';
		if (coverPreview) URL.revokeObjectURL(coverPreview);
		coverFile = file;
		coverPreview = URL.createObjectURL(file);
	}

	async function save() {
		if (saving) return;
		if (!dirty) {
			close();
			return;
		}
		saving = true;
		error = '';
		const failed: string[] = [];
		try {
			if (titleDirty) {
				const next = title.trim();
				try {
					await albumActions.updateTitle(album.id, next);
					onSaved({ title: next });
				} catch (e) {
					failed.push(e instanceof Error ? e.message : 'failed to save title');
				}
			}
			if (coverFile) {
				try {
					const result = await albumActions.uploadCover(album.id, coverFile);
					coverFile = null;
					onSaved({ image_url: result.image_url });
				} catch (e) {
					failed.push(e instanceof Error ? e.message : 'failed to upload cover');
				}
			}
			if (settingsDirty && settings) {
				try {
					await settings.save();
				} catch (e) {
					failed.push(e instanceof Error ? e.message : 'failed to save album settings');
				}
			}
		} finally {
			saving = false;
		}
		if (failed.length > 0) {
			error = failed.join('; ');
			return;
		}
		toast.success('album saved');
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
	<form
		class="editor"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<header>
			<h2 id={titleId}>edit album</h2>
			<button
				class="icon-button"
				type="button"
				aria-label="close edit album"
				disabled={saving}
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
		</header>

		<div class="body">
			<div class="details">
				<button
					type="button"
					class="cover"
					aria-label="change cover image"
					disabled={saving}
					onclick={() => coverInput?.click()}
				>
					{#if cover}
						<img src={cover} alt="" />
					{/if}
					<span class="cover-overlay" class:empty={!cover}
						>{cover ? 'change cover' : 'add cover'}</span
					>
				</button>
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					bind:this={coverInput}
					onchange={pickCover}
					hidden
				/>
				<label class="field">
					<span>title</span>
					<input type="text" bind:value={title} placeholder="album title" disabled={saving} />
				</label>
			</div>

			<h3>settings</h3>
			<AlbumPublishingEditor
				bind:this={settings}
				bind:dirty={settingsDirty}
				{album}
				{tracks}
				onchange={(_, enabled) => onSaved({ show_plylst: enabled })}
				onpreview={(enabled) => onPlylstPreview?.(enabled)}
			/>
		</div>

		<footer>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<div class="actions">
				<button type="button" class="cancel" disabled={saving} onclick={requestClose}>cancel</button
				>
				<button type="submit" class="save" disabled={saving || !dirty}
					>{saving ? 'saving…' : 'save'}</button
				>
			</div>
		</footer>
	</form>
</dialog>

<ConfirmDialog
	bind:open={discardOpen}
	title="discard changes?"
	body="your unsaved album changes will be lost."
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

<style>
	dialog {
		padding: 0;
		width: min(560px, calc(100vw - 32px));
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
	.editor {
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - 48px);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px 12px 24px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.body {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 20px 24px 8px;
	}
	.details {
		display: grid;
		grid-template-columns: 128px 1fr;
		gap: 20px;
		align-items: center;
	}
	.cover {
		position: relative;
		width: 128px;
		aspect-ratio: 1;
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-tertiary, var(--bg-primary));
		font: inherit;
		cursor: pointer;
	}
	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.cover-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 55%);
		color: #fff;
		font-size: var(--text-sm);
		opacity: 0;
		transition: opacity 140ms;
	}
	.cover-overlay.empty {
		opacity: 1;
		background: none;
		color: var(--text-secondary);
	}
	.cover:hover .cover-overlay,
	.cover:focus-visible .cover-overlay {
		opacity: 1;
	}
	.cover:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.field {
		display: grid;
		gap: 6px;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.field input {
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		background: var(--bg-primary);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--text-lg);
	}
	.field input:focus {
		outline: none;
		border-color: var(--accent);
	}
	h3 {
		margin: 28px 0 0;
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--text-tertiary, var(--text-secondary));
	}
	footer {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 24px;
		border-top: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.actions button {
		min-height: 40px;
		padding: 0 18px;
		border: 0;
		border-radius: var(--radius-full);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.cancel {
		background: transparent;
		color: var(--text-secondary);
	}
	.cancel:hover:not(:disabled) {
		color: var(--text-primary);
		background: var(--bg-hover);
	}
	.save {
		background: var(--accent);
		color: var(--accent-contrast);
		font-weight: 600;
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--error);
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
	}
	.icon-button:hover {
		background: var(--bg-hover);
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
		}
		header {
			padding-inline: 16px 8px;
		}
		.body {
			padding-inline: 16px;
		}
		.details {
			grid-template-columns: 96px 1fr;
			gap: 14px;
		}
		.cover {
			width: 96px;
		}
		.cover-overlay {
			opacity: 1;
			background: rgb(0 0 0 / 40%);
			font-size: var(--text-xs);
		}
		footer {
			padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
		}
		.actions button {
			flex: 1;
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open],
		dialog.closing,
		dialog::backdrop {
			animation: none;
		}
	}
</style>
