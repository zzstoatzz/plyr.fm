<script lang="ts">
	// sheet: add menus.addTo to one of your playlists, or a new one.
	import { api, type ListSummary } from './api';
	import { auth } from './auth.svelte';
	import { menus } from './menus.svelte';
	import { addToPlaylist, createPlaylist } from './pds';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Sheet from './ui/Sheet.svelte';
	import { toast, writeNote } from './ui/toast.svelte';

	let mine = $state<ListSummary[] | null>(null);
	let name = $state('');
	$effect(() => {
		if (menus.addTo && auth.did) {
			mine = null;
			api
				.playlists({ owner_did: auth.did, limit: 100 })
				.then((p) => (mine = p.data))
				.catch(() => (mine = []));
		}
	});
	let busy = $state(false);

	async function run(action: () => Promise<string>, label: string) {
		busy = true;
		try {
			toast.show(writeNote(await action(), label));
			menus.addTo = null;
		} catch (e) {
			toast.show((e as Error).message);
		} finally {
			busy = false;
		}
	}
</script>

<Sheet open={!!menus.addTo} onclose={() => (menus.addTo = null)} title="add to playlist">
	{#if menus.addTo}
		{@const track = menus.addTo}
		<form
			class="new"
			onsubmit={(e) => {
				e.preventDefault();
				const n = name.trim();
				if (n) run(async () => (await createPlaylist(n, track)).status, `added to ${n}`).then(() => (name = ''));
			}}
		>
			<input class="input" bind:value={name} placeholder="new playlist" maxlength="64" aria-label="new playlist name" />
			<button class="btn primary" disabled={busy || !name.trim()}>create</button>
		</form>
		<div class="list">
			{#if mine === null}
				<p class="muted pad">loading…</p>
			{:else}
				{#each mine as list (list.id)}
					<button
						class="row-item"
						disabled={busy}
						onclick={() => run(() => addToPlaylist(list.record.uri, track), `added to ${list.metadata.name ?? 'playlist'}`)}
					>
						<Artwork seed={list.metadata.name ?? list.id} size={40} />
						<span class="grow">
							<span class="ellipsis" style="display:block">{list.metadata.name ?? 'untitled'}</span>
							<span class="muted small">{list.metrics.member_count} tracks</span>
						</span>
						<Icon name="plus" size={18} />
					</button>
				{:else}
					<p class="muted small">no playlists yet. name one above.</p>
				{/each}
			{/if}
		</div>
	{/if}
</Sheet>

<style>
	.new {
		display: flex;
		gap: var(--s-sm);
		margin-bottom: var(--s-md);
	}
	.new .input {
		flex: 1;
		min-width: 0;
	}
	.row-item {
		padding-left: 0;
		padding-right: var(--s-xs);
	}
	.list {
		max-height: 50dvh;
		overflow: auto;
	}
</style>
