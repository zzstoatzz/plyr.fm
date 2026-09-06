<script lang="ts">
	import { onDestroy } from 'svelte';
	interface Props {
		imageUrl: string | null | undefined;
		editImageFile: File | null;
		editRemoveImage: boolean;
	}
	let { imageUrl, editImageFile = $bindable(), editRemoveImage = $bindable() }: Props = $props();
	let editImagePreviewUrl = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	onDestroy(() => {
		if (editImagePreviewUrl) URL.revokeObjectURL(editImagePreviewUrl);
	});
</script>

<div class="edit-field-group">
	<span class="edit-label">artwork (optional)</span>
	{#if fileError}<p class="save-error" role="alert">{fileError}</p>{/if}
	<div class="artwork-editor">
		{#if editImagePreviewUrl}
			<div class="artwork-preview">
				<img src={editImagePreviewUrl} alt="new artwork preview" />
				<div class="artwork-preview-overlay">
					<button
						type="button"
						class="artwork-action-btn"
						onclick={() => {
							editImageFile = null;
							if (editImagePreviewUrl) {
								URL.revokeObjectURL(editImagePreviewUrl);
							}
							editImagePreviewUrl = null;
						}}
						title="remove selection"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>
			</div>
			<span class="artwork-status">new artwork selected</span>
		{:else if editRemoveImage}
			<div class="artwork-removed">
				<svg
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<line x1="9" y1="9" x2="15" y2="15"></line>
					<line x1="15" y1="9" x2="9" y2="15"></line>
				</svg>
				<span>artwork will be removed</span>
				<button
					type="button"
					class="undo-remove-btn"
					onclick={() => {
						editRemoveImage = false;
					}}
				>
					undo
				</button>
			</div>
		{:else if imageUrl}
			<div class="artwork-preview">
				<img src={imageUrl} alt="current artwork" />
				<div class="artwork-preview-overlay">
					<button
						type="button"
						class="artwork-action-btn"
						onclick={() => {
							editRemoveImage = true;
						}}
						title="remove artwork"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<polyline points="3 6 5 6 21 6"></polyline>
							<path
								d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
							></path>
						</svg>
					</button>
				</div>
			</div>
			<span class="artwork-status current">current artwork</span>
		{:else}
			<div class="artwork-empty">
				<svg
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<circle cx="8.5" cy="8.5" r="1.5"></circle>
					<polyline points="21 15 16 10 5 21"></polyline>
				</svg>
				<span>no artwork</span>
			</div>
		{/if}
		{#if !editRemoveImage}
			<label class="artwork-upload-btn">
				<input
					type="file"
					accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
					onchange={(e) => {
						const target = e.currentTarget;
						const file = target.files?.[0];
						if (file) {
							if (file.size > 20 * 1024 * 1024) {
								fileError = 'image must be under 20 MB';
								target.value = '';
								return;
							}
							fileError = null;
							editImageFile = file;
							if (editImagePreviewUrl) {
								URL.revokeObjectURL(editImagePreviewUrl);
							}
							editImagePreviewUrl = URL.createObjectURL(file);
						}
					}}
				/>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="17 8 12 3 7 8"></polyline>
					<line x1="12" y1="3" x2="12" y2="15"></line>
				</svg>
				{imageUrl || editImagePreviewUrl ? 'replace' : 'upload'}
			</label>
		{/if}
	</div>
</div>

<style>
	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.edit-label {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.015em;
		color: var(--text-primary);
	}
	.artwork-editor {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
	}
	.artwork-preview {
		position: relative;
		width: 80px;
		height: 80px;
		border-radius: var(--radius-base);
		overflow: hidden;
		flex-shrink: 0;
	}
	.artwork-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.artwork-preview-overlay {
		position: absolute;
		inset: 0;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.artwork-preview:hover .artwork-preview-overlay {
		opacity: 1;
	}
	.artwork-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: var(--bg-primary);
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-primary);
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
	}
	.artwork-action-btn:hover {
		background: var(--error);
		transform: scale(1.1);
		box-shadow: none;
	}
	.artwork-status {
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-weight: 500;
	}
	.artwork-status.current {
		color: var(--text-tertiary);
		font-weight: 400;
	}
	.artwork-removed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		color: var(--text-tertiary);
	}
	.artwork-removed span {
		font-size: var(--text-sm);
	}
	.undo-remove-btn {
		padding: 0.25rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--text-primary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
		width: auto;
	}
	.undo-remove-btn:hover {
		border-color: var(--text-primary);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		transform: none;
		box-shadow: none;
	}
	.artwork-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		color: var(--text-tertiary);
	}
	.artwork-empty span {
		font-size: var(--text-sm);
	}
	.artwork-upload-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--text-primary);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
		margin-left: auto;
	}
	.artwork-upload-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.artwork-upload-btn input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	@media (max-width: 600px) {
		.edit-field-group {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
		.edit-label {
			font-size: var(--text-sm);
		}
		.artwork-editor {
			flex-direction: column;
			gap: 0.75rem;
			padding: 0.65rem;
		}
		.artwork-preview {
			width: 64px;
			height: 64px;
		}
		.artwork-upload-btn {
			position: relative;
			margin-left: 0;
		}
	}
	.save-error {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0;
	}
	.artwork-preview-overlay {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.edit-field-group,
		.artwork-preview-overlay {
			transition: none;
		}
	}
	.artwork-upload-btn:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
