<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
	import { preferences } from '$lib/preferences.svelte';
	import { changePublishing } from '$lib/publishing-jobs';
	import type { PublishingDefaults } from '$lib/publishing';
	import type { AlbumMetadata, Track } from '$lib/types';
	import PublishingSettings from './PublishingSettings.svelte';

	let { album, tracks }: { album: AlbumMetadata; tracks: Track[] } = $props();
	let override = $state<PublishingDefaults | null>(null);
	let replaceOverrides = $state(false);
	let saving = $state(false);
	let result = $state('');
	const exceptions = $derived(tracks.filter((track) => track.policy_origin === 'track').length);
	const selectedCount = $derived(replaceOverrides ? tracks.length : tracks.length - exceptions);
	onMount(() => {
		override = album.publishing_defaults ?? null;
		void preferences.fetch();
	});

	async function apply(): Promise<void> {
		saving = true;
		result = '';
		try {
			await changePublishing(`/albums/${album.id}/publishing`, {
				settings: override,
				replace_overrides: replaceOverrides
			});
			result = `album defaults saved; ${selectedCount} ${selectedCount === 1 ? 'track' : 'tracks'} updated`;
			await invalidateAll();
		} catch (error) {
			result = error instanceof Error ? error.message : 'could not update access — retry';
		} finally {
			saving = false;
		}
	}
</script>

<section aria-label="album access">
	<fieldset disabled={saving || !preferences.data}>
		<PublishingSettings
			bind:value={override}
			defaults={preferences.publishingDefaults}
			scope="album"
			showRights={auth.user?.enabled_flags?.includes(COPYRIGHT_PARADIGM_FLAG)}
		/>
		<p>
			save defaults for new album tracks and apply them to {selectedCount} existing {selectedCount ===
			1
				? 'track'
				: 'tracks'}.
		</p>
		{#if exceptions > 0}
			<label
				><input type="checkbox" bind:checked={replaceOverrides} />also replace {exceptions} track {exceptions ===
				1
					? 'override'
					: 'overrides'}</label
			>
		{/if}
		<p>audio that was already public cannot be recalled.</p>
		<button type="button" onclick={() => void apply()}
			>{saving ? 'updating access…' : 'apply album settings'}</button
		>
	</fieldset>
	{#if result}<p role="status">{result}</p>{/if}
</section>

<style>
	section {
		margin-block: 1.5rem;
		display: grid;
		gap: 0.75rem;
	}
	fieldset {
		padding: 0;
		border: 0;
		display: grid;
		gap: 0.75rem;
	}
	p {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
		line-height: 1.5;
	}
	label {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	button {
		justify-self: start;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-secondary);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
	}
</style>
