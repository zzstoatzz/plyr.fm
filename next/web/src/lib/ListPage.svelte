<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ListDetail, Track } from './api';
	import { auth } from './auth.svelte';
	import { share } from './menus.svelte';
	import { deletePlaylist, removeFromPlaylist, renamePlaylist } from './pds';
	import { player, plural } from './player.svelte';
	import TrackRow from './TrackRow.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import ScreenHeader from './ui/ScreenHeader.svelte';
	import Sheet from './ui/Sheet.svelte';
	import { toast, writeNote } from './ui/toast.svelte';

	let { load }: { load: () => Promise<ListDetail> } = $props();
	let list = $state<ListDetail | null>(null);
	let error = $state<string | null>(null);
	const tracks = $derived((list?.members ?? []).map((m) => m.track).filter((t): t is Track => !!t));
	// your own playlist is editable here; the edit goes to your PDS, then we
	// re-read the appview once it has projected the new record.
	const editable = $derived(!!list && list.object === 'playlist' && list.owner.did === auth.did);
	const cover = $derived(tracks.find((t) => t.media.artwork?.url)?.media.artwork?.url ?? null);
	const minutes = $derived(Math.round(tracks.reduce((n, t) => n + (t.metadata.duration_seconds ?? 0), 0) / 60));
	let busy = $state(false);
	let manage = $state(false);
	let name = $state('');
	let confirmDelete = $state(false);

	async function edit(action: () => Promise<string>, done: string, after?: () => void) {
		busy = true;
		try {
			toast.show(writeNote(await action(), done));
			if (after) after();
			else list = await load();
		} catch (e) {
			toast.show((e as Error).message);
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		list = null;
		error = null;
		load().then((l) => (list = l)).catch((e) => (error = e.message));
	});

	function shufflePlay() {
		if (!player.shuffle) player.toggleShuffle();
		player.play(tracks, Math.floor(Math.random() * tracks.length));
	}
</script>

<ScreenHeader title={list?.object ?? ''}>
	{#snippet slot()}
		{#if editable}
			<button class="btn ghost icon" onclick={() => ((name = list!.metadata.name ?? ''), (confirmDelete = false), (manage = true))} aria-label="edit playlist">
				<Icon name="more" stroke={3} />
			</button>
		{/if}
	{/snippet}
</ScreenHeader>

{#if error}
	<p class="error pad">{error}</p>
{:else if list}
	<section class="head">
		<div class="art"><Artwork src={cover} seed={list.metadata.name ?? list.id} size="100%" radius="var(--r-md)" /></div>
		<div class="info">
			<h1>{list.metadata.name ?? 'untitled'}</h1>
			<a class="owner" href="/u/{list.owner.profile?.handle ?? list.owner.did}">
				{list.owner.profile?.display_name || list.owner.profile?.handle || list.owner.did}
			</a>
			<p class="muted small">
				{plural(list.metrics.member_count, 'track')}{#if minutes}{' · '}{minutes} min{/if}
				{#if list.metrics.available_count < list.metrics.member_count}{' · '}{list.metrics.member_count - list.metrics.available_count} unavailable{/if}
			</p>
		</div>
	</section>
	<div class="actions">
		<button class="btn primary" disabled={!tracks.length} onclick={() => player.play(tracks)}><Icon name="play" size={16} /> play</button>
		<button class="btn outline" disabled={!tracks.length} onclick={shufflePlay}><Icon name="shuffle" size={16} /> shuffle</button>
		<button
			class="btn outline icon"
			aria-label="share"
			onclick={async () => (await share(location.pathname, list!.metadata.name ?? 'playlist')) === 'copied' && toast.show('link copied')}
		>
			<Icon name="share" size={18} />
		</button>
	</div>
	<ol class="plain">
		{#each tracks as track, i (track.id)}
			<TrackRow {tracks} index={i}>
				{#snippet actions()}
					{#if editable}
						<button
							class="btn ghost icon sm"
							disabled={busy}
							aria-label="remove {track.metadata.title}"
							onclick={() => edit(() => removeFromPlaylist(list!.record.uri, track.record.uri), 'removed')}
						>
							<Icon name="x" size={16} />
						</button>
					{/if}
				{/snippet}
			</TrackRow>
		{:else}
			<p class="empty">{editable ? 'empty for now. add tracks from any track\'s … menu.' : 'no tracks.'}</p>
		{/each}
	</ol>
{:else}
	<p class="empty">loading…</p>
{/if}

<Sheet bind:open={manage} title="edit playlist">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			const n = name.trim();
			if (n) edit(() => renamePlaylist(list!.record.uri, n), 'renamed').then(() => (manage = false));
		}}
	>
		<label class="field">
			<span>name</span>
			<input bind:value={name} maxlength="64" />
		</label>
		<button class="btn primary block lg" disabled={busy || !name.trim()}>save</button>
	</form>
	<hr class="divider" />
	{#if confirmDelete}
		<p class="small">delete this playlist from your PDS?</p>
		<div class="confirm">
			<button class="btn outline" onclick={() => (confirmDelete = false)}>cancel</button>
			<button class="btn negative" disabled={busy} onclick={() => edit(() => deletePlaylist(list!.record.uri), 'deleted', () => goto('/library'))}>delete</button>
		</div>
	{:else}
		<button class="btn ghost block danger" onclick={() => (confirmDelete = true)}><Icon name="trash" size={18} /> delete playlist</button>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		padding: var(--s-lg);
	}
	.art {
		width: min(100%, 240px);
		aspect-ratio: 1;
		align-self: center;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: var(--s-2xs);
	}
	h1 {
		font-size: var(--t-3xl);
		font-weight: 800;
	}
	.owner {
		font-weight: 600;
	}
	p {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: var(--s-sm);
		padding: 0 var(--s-lg) var(--s-md);
	}
	.confirm {
		display: flex;
		gap: var(--s-sm);
		justify-content: flex-end;
	}
	.danger {
		color: var(--negative);
	}
	@media (min-width: 500px) {
		.head {
			flex-direction: row;
			align-items: flex-end;
		}
		.art {
			width: 180px;
			flex-shrink: 0;
		}
	}
</style>
