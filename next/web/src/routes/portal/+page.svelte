<script lang="ts">
	// the artist portal: your profile, tracks, albums and playlists, all
	// edited straight on your PDS.
	import { api, type ListSummary, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { deleteTrack, editTrack, myProfile, saveProfile, type ProfileRecord } from '$lib/pds';
	import { formatDuration, plural } from '$lib/player.svelte';
	import ArtworkPicker from '$lib/ArtworkPicker.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { toast, writeNote } from '$lib/ui/toast.svelte';

	let profile = $state<{ value: ProfileRecord | null; cid: string | null } | null>(null);
	let tracks = $state<Track[] | null>(null);
	let albums = $state<ListSummary[]>([]);
	let playlists = $state<ListSummary[]>([]);
	let loadedFor: string | null = null;

	$effect(() => {
		const did = auth.did;
		if (!did || loadedFor === did) return;
		loadedFor = did;
		load(did);
	});

	async function load(did: string) {
		myProfile().then((p) => (profile = p)).catch((e) => toast.show(e.message));
		api.tracks({ artist_did: did, limit: 100 }).then((p) => (tracks = p.data)).catch(() => (tracks = []));
		api.albums(did).then((p) => (albums = p.data)).catch(() => {});
		api.playlists({ owner_did: did, limit: 100 }).then((p) => (playlists = p.data)).catch(() => {});
	}

	// profile sheet
	let editingProfile = $state(false);
	let bio = $state('');
	let avatar = $state('');
	let busy = $state(false);

	function openProfile() {
		bio = profile?.value?.bio ?? '';
		avatar = profile?.value?.avatar ?? '';
		editingProfile = true;
	}

	async function submitProfile(e: SubmitEvent) {
		e.preventDefault();
		if (!profile) return;
		if (avatar.trim() && !avatar.trim().startsWith('https://')) return toast.show('avatar has to be an https:// url');
		busy = true;
		try {
			const status = await saveProfile({ bio, avatar }, profile);
			toast.show(writeNote(status, 'profile saved'));
			editingProfile = false;
			profile = await myProfile();
		} catch (err) {
			toast.show((err as Error).message);
		} finally {
			busy = false;
		}
	}

	// track sheet
	let editing = $state<Track | null>(null);
	let confirmDelete = $state(false);
	let title = $state('');
	let album = $state('');
	let description = $state('');
	let artwork = $state<File | null | undefined>(undefined);

	function openTrack(t: Track) {
		editing = t;
		confirmDelete = false;
		title = t.metadata.title;
		album = t.metadata.album ?? '';
		description = t.metadata.description ?? '';
		artwork = undefined;
	}

	async function submitTrack(e: SubmitEvent) {
		e.preventDefault();
		if (!editing) return;
		busy = true;
		try {
			const status = await editTrack(editing.record.uri, { title, album, description, artwork });
			toast.show(writeNote(status, 'track saved'));
			editing = null;
			if (auth.did) tracks = (await api.tracks({ artist_did: auth.did, limit: 100 })).data;
		} catch (err) {
			toast.show((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!editing) return;
		const t = editing;
		busy = true;
		try {
			const status = await deleteTrack(t.record.uri);
			toast.show(status === 'deleted' || status === 'absent' ? 'track deleted' : writeNote(status, 'track deleted'));
			tracks = (tracks ?? []).filter((x) => x.id !== t.id);
			editing = null;
		} catch (err) {
			toast.show((err as Error).message);
		} finally {
			busy = false;
		}
	}

	const plays = $derived((tracks ?? []).reduce((n, t) => n + t.metrics.play_count, 0));
	const likes = $derived((tracks ?? []).reduce((n, t) => n + t.metrics.like_count, 0));
</script>

<ScreenHeader title="portal" back={false}>
	{#snippet slot()}
		<a class="btn ghost icon" href="/settings" aria-label="settings"><Icon name="settings" /></a>
	{/snippet}
</ScreenHeader>

{#if !auth.ready}
	<p class="empty">loading…</p>
{:else if !auth.did}
	<div class="empty">
		<p>sign in to manage your profile and tracks.</p>
		<a class="btn primary" href="/login">sign in</a>
	</div>
{:else}
	<section class="me">
		{#if profile?.value?.avatar || auth.avatar}
			<img class="avatar" src={profile?.value?.avatar || auth.avatar} alt="" width="72" height="72" />
		{:else}
			<span class="avatar"></span>
		{/if}
		<div class="who">
			<strong class="name ellipsis">{auth.displayName ?? auth.handle}</strong>
			<span class="muted ellipsis">@{auth.handle ?? auth.did}</span>
			{#if profile?.value?.bio}<p class="bio">{profile.value.bio}</p>{/if}
		</div>
	</section>
	<div class="stats small">
		<span><strong>{tracks?.length ?? '–'}</strong> {tracks?.length === 1 ? 'track' : 'tracks'}</span>
		<span><strong>{plays}</strong> plays</span>
		<span><strong>{likes}</strong> likes</span>
	</div>
	<div class="actions">
		<a class="btn primary" href="/upload"><Icon name="upload" size={18} /> upload</a>
		<button class="btn outline" onclick={openProfile} disabled={!profile}><Icon name="edit" size={18} /> edit profile</button>
		<a class="btn outline icon" href="/u/{auth.handle ?? auth.did}" aria-label="view public profile"><Icon name="user" size={18} /></a>
	</div>

	<h2 class="section">your tracks</h2>
	{#if tracks === null}
		<p class="muted pad small">loading…</p>
	{:else if !tracks.length}
		<p class="muted pad small">nothing yet. <a href="/upload">upload your first track</a>.</p>
	{:else}
		<div class="list">
			{#each tracks as t (t.id)}
				<button class="row-item" onclick={() => openTrack(t)}>
					<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size={44} />
					<span class="grow">
						<span class="ellipsis" style="display:block;font-weight:600">{t.metadata.title}</span>
						<span class="muted small">
							{t.metrics.play_count} plays · {t.metrics.like_count} likes{#if t.metadata.duration_seconds}{' · '}{formatDuration(t.metadata.duration_seconds)}{/if}
							{#if t.access.visibility !== 'public'}{' · '}{t.access.visibility}{/if}
						</span>
					</span>
					<span class="chev"><Icon name="edit" size={18} /></span>
				</button>
			{/each}
		</div>
	{/if}

	{#if albums.length}
		<h2 class="section">albums</h2>
		<div class="list">
			{#each albums as a (a.id)}
				<a class="row-item" href="/album/{a.id}">
					<Artwork src={a.media?.artwork?.url} seed={a.metadata.name ?? a.id} size={44} />
					<span class="grow">
						<span class="ellipsis" style="display:block;font-weight:600">{a.metadata.name ?? 'untitled'}</span>
						<span class="muted small">{plural(a.metrics.member_count, 'track')}</span>
					</span>
					<span class="chev"><Icon name="chevron" size={18} /></span>
				</a>
			{/each}
		</div>
	{/if}

	<div class="section"><span>playlists</span><a href="/library">library</a></div>
	<div class="list">
		{#each playlists as p (p.id)}
			<a class="row-item" href="/playlist/{p.id}">
				<Artwork src={p.media?.artwork?.url} seed={p.metadata.name ?? p.id} size={44} />
				<span class="grow">
					<span class="ellipsis" style="display:block;font-weight:600">{p.metadata.name ?? 'untitled'}</span>
					<span class="muted small">{plural(p.metrics.member_count, 'track')}</span>
				</span>
				<span class="chev"><Icon name="chevron" size={18} /></span>
			</a>
		{:else}
			<p class="muted pad small">no playlists yet.</p>
		{/each}
	</div>
{/if}

<Sheet bind:open={editingProfile} title="edit profile">
	<form onsubmit={submitProfile}>
		<p class="hint">your plyr profile record (fm.plyr.actor.profile) on your PDS. your name comes from your bluesky profile.</p>
		<label class="field">
			<span>bio</span>
			<textarea bind:value={bio} maxlength="2560"></textarea>
		</label>
		<label class="field">
			<span>avatar url</span>
			<input bind:value={avatar} type="url" placeholder="https://…" />
		</label>
		<button class="btn primary block lg" disabled={busy}>{busy ? 'saving…' : 'save'}</button>
	</form>
</Sheet>

<Sheet open={!!editing} onclose={() => (editing = null)} title="edit track">
	{#if editing}
		<form onsubmit={submitTrack}>
			<div class="field">
				<span>cover art</span>
				<ArtworkPicker bind:value={artwork} current={editing.media.artwork?.url ?? null} seed={title} />
			</div>
			<label class="field">
				<span>title</span>
				<input bind:value={title} maxlength="256" required />
			</label>
			<label class="field">
				<span>album</span>
				<input bind:value={album} maxlength="256" />
			</label>
			<label class="field">
				<span>description</span>
				<textarea bind:value={description} maxlength="5000"></textarea>
			</label>
			<button class="btn primary block lg" disabled={busy || !title.trim()}>{busy ? 'saving…' : 'save'}</button>
		</form>
		<hr class="divider" />
		{#if confirmDelete}
			<p class="small">delete "{editing.metadata.title}" from your PDS? this removes the record everywhere, including plyr.fm.</p>
			<div class="confirm">
				<button class="btn outline" onclick={() => (confirmDelete = false)} disabled={busy}>cancel</button>
				<button class="btn negative" onclick={remove} disabled={busy}>{busy ? 'deleting…' : 'delete'}</button>
			</div>
		{:else}
			<button class="btn ghost block danger" onclick={() => (confirmDelete = true)}><Icon name="trash" size={18} /> delete track</button>
		{/if}
	{/if}
</Sheet>

<style>
	.me {
		display: flex;
		gap: var(--s-lg);
		align-items: center;
		padding: var(--s-xl) var(--s-lg) var(--s-md);
	}
	.avatar {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--c-50);
		flex-shrink: 0;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.name {
		font-size: var(--t-2xl);
	}
	.bio {
		margin: var(--s-xs) 0 0;
		font-size: var(--t-sm);
		white-space: pre-wrap;
	}
	.stats {
		display: flex;
		gap: var(--s-lg);
		padding: 0 var(--s-lg);
		color: var(--c-600);
	}
	.stats strong {
		color: var(--c-1000);
	}
	.actions {
		display: flex;
		gap: var(--s-sm);
		padding: var(--s-md) var(--s-lg) var(--s-sm);
	}
	.confirm {
		display: flex;
		gap: var(--s-sm);
		justify-content: flex-end;
	}
	.danger {
		color: var(--negative);
	}
	.empty .btn {
		margin-top: var(--s-md);
	}
</style>
