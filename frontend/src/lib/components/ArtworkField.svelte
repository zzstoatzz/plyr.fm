<script lang="ts">
	import LuminframePicker from '$lib/components/LuminframePicker.svelte';
	import { getServerConfig } from '$lib/config';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		/** signed-in user's DID — enables the luminframe source when present. */
		did?: string;
		/** the chosen artwork. bindable; setting it to null from outside resets the field. */
		file?: File | null;
	}

	let { did, file = $bindable(null) }: Props = $props();

	let previewUrl = $state<string | null>(null);
	let source = $state<'file' | 'luminframe' | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	// the parent can clear the slot (post-submit reset) by setting `file` to
	// null; sweep up this component's residue when that happens externally.
	$effect(() => {
		if (file === null && previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			source = null;
			if (inputEl) inputEl.value = '';
		}
	});

	async function validateSize(selected: File): Promise<boolean> {
		try {
			const config = await getServerConfig();
			const sizeMB = selected.size / (1024 * 1024);
			if (sizeMB > config.max_image_size_mb) {
				toast.error(`image too large (${sizeMB.toFixed(1)}MB). max: ${config.max_image_size_mb}MB`);
				return false;
			}
		} catch (_e) {
			console.error('failed to validate image size:', _e);
		}
		return true;
	}

	// the one place artwork is set, whichever source it came from. the slot
	// holds exactly one image, so every set clears the other source's residue:
	// the object URL, and the native input's own filename display.
	function setFile(selected: File | null, from?: 'file' | 'luminframe') {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = selected ? URL.createObjectURL(selected) : null;
		source = selected ? (from ?? null) : null;
		file = selected;
		if (inputEl && from !== 'file') inputEl.value = '';
	}

	async function handleInputChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const selected = target.files[0];

			if (!(await validateSize(selected))) {
				target.value = '';
				setFile(null);
				return;
			}

			setFile(selected, 'file');
		}
	}

	async function handleLuminframeSelect(selected: File) {
		if (!(await validateSize(selected))) return;
		setFile(selected, 'luminframe');
	}
</script>

<span class="artwork-label" id="artwork-label">artwork (optional)</span>
<!-- two ways to fill one slot, presented as peers. the native
     input stays in the DOM (it does the file dialog) but the
     visible affordance is a button that matches the picker's. -->
<div class="artwork-sources" role="group" aria-labelledby="artwork-label">
	<button type="button" class="source-btn" onclick={() => inputEl?.click()}>
		{file ? 'replace with a file' : 'choose a file'}
	</button>
	{#if did}
		<LuminframePicker {did} onSelect={handleLuminframeSelect} />
	{/if}
</div>
<input
	bind:this={inputEl}
	id="image-input"
	type="file"
	accept="image/*"
	tabindex="-1"
	aria-hidden="true"
	class="hidden-file-input"
	onchange={handleInputChange}
/>
<p class="format-hint">supported: jpg, png, webp, gif</p>
{#if file}
	<div class="artwork-chosen">
		{#if previewUrl}
			<img class="artwork-preview" src={previewUrl} alt="chosen artwork preview" />
		{/if}
		<div class="artwork-meta">
			<p class="file-info">
				{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
			</p>
			<p class="artwork-source">
				from {source === 'luminframe' ? 'luminframe' : 'your device'}
			</p>
		</div>
		<button
			type="button"
			class="artwork-remove"
			onclick={() => setFile(null)}
			title="remove artwork"
			aria-label="remove artwork"
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
{/if}

<style>
	.artwork-label {
		display: block;
		margin-bottom: 0.5rem;
	}

	.artwork-sources {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.source-btn {
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

	.source-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	/* the input still opens the file dialog; the button above is its face */
	.hidden-file-input {
		display: none;
	}

	.format-hint {
		margin-top: 0.25rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.artwork-chosen {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.artwork-preview {
		width: 3.5rem;
		height: 3.5rem;
		object-fit: cover;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.artwork-meta {
		min-width: 0;
	}

	.file-info {
		margin-top: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.artwork-source {
		margin-top: 0.125rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.artwork-remove {
		margin-left: auto;
		display: flex;
		align-items: center;
		padding: 0.375rem;
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		flex-shrink: 0;
	}

	.artwork-remove:hover {
		color: var(--text-primary);
	}
</style>
