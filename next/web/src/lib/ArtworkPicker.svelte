<script lang="ts">
	// pick cover art: preview, change, remove. `value` is a new File, null to
	// remove the current cover, or undefined to leave it alone.
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let {
		value = $bindable<File | null | undefined>(undefined),
		current = null,
		seed = ''
	}: { value?: File | null; current?: string | null; seed?: string } = $props();

	let preview = $state<string | null>(null);
	$effect(() => {
		if (!(value instanceof File)) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(value);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});
	const shown = $derived(preview ?? (value === null ? null : current));
</script>

<div class="picker">
	<label class="art" aria-label="choose cover art">
		<Artwork src={shown} {seed} size={96} radius="var(--r-md)" />
		<span class="overlay"><Icon name="edit" size={18} /></span>
		<input
			type="file"
			accept="image/png,image/jpeg,image/webp,image/gif"
			onchange={(e) => {
				const f = (e.currentTarget as HTMLInputElement).files?.[0];
				if (f) value = f;
			}}
		/>
	</label>
	<div class="side">
		<span class="hint">{value instanceof File ? value.name : shown ? 'current cover' : 'no cover yet'}</span>
		<span class="hint">png, jpeg, webp or gif · stored on your PDS</span>
		{#if shown}
			<button type="button" class="btn ghost sm" onclick={() => (value = value instanceof File || !current ? undefined : null)}>
				<Icon name="trash" size={16} /> {value instanceof File && current ? 'undo' : 'remove'}
			</button>
		{/if}
	</div>
</div>

<style>
	.picker {
		display: flex;
		align-items: center;
		gap: var(--s-lg);
	}
	.art {
		position: relative;
		cursor: pointer;
		border-radius: var(--r-md);
	}
	.art:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.art input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.overlay {
		position: absolute;
		right: 6px;
		bottom: 6px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.6);
		color: #fff;
	}
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-2xs);
		min-width: 0;
	}
	.side .btn {
		margin-left: calc(-1 * var(--s-md));
	}
</style>
