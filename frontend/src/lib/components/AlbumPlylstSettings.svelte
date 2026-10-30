<script lang="ts">
	import { updatePlylstLink } from '$lib/album-actions';

	let {
		albumId,
		enabled,
		onchange
	}: {
		albumId: string;
		enabled: boolean;
		onchange: (albumId: string, enabled: boolean) => void;
	} = $props();
	let checked = $state(enabled);
	let saving = $state(false);
	let error = $state('');
	$effect(() => {
		checked = enabled;
	});

	async function save(next: boolean): Promise<void> {
		const id = albumId;
		const previous = checked;
		checked = next;
		saving = true;
		error = '';
		try {
			await updatePlylstLink(id, next);
			onchange(id, next);
		} catch {
			if (id === albumId) {
				checked = previous;
				error = 'could not save plylst link — retry';
			}
		} finally {
			saving = false;
		}
	}
</script>

<section aria-label="external playback">
	<label
		><input
			type="checkbox"
			{checked}
			disabled={saving}
			onchange={(event) => void save(event.currentTarget.checked)}
		/>show plylst link <span class="experimental">experimental</span></label
	>
	<p>open this album in a waveform player. available for public listening only.</p>
	{#if error}<p role="alert">{error}</p>{/if}
</section>

<style>
	section {
		margin-block: 1.5rem;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	input {
		accent-color: var(--accent);
	}
	p {
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.experimental {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
</style>
