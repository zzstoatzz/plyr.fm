<script lang="ts">
	import { onMount } from 'svelte';
	import type { Track } from '$core/api';
	import type { PrivateCreate, PrivateResult } from '$core/publishing/private-music';
	import { auth } from './auth';
	import { privateMusic } from './private-library';
	import { fileDuration } from './media/file-duration';
	import { player } from './player.svelte';
	import { artistName } from './tracks';
	import Icon from './ui/Icon.svelte';
	import Loading from './ui/Loading.svelte';

	let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();
	const pds = $derived(privateMusic(account));
	let live = false;
	let generation = 0;
	const current = () => live && auth.getAuth().rpc === account.rpc && auth.getAuth().did === account.did;
	let tracks = $state.raw<Track[]>([]);
	let cursor = $state<string>();
	let pending = $state.raw<PrivateCreate[]>([]);
	let results = $state<Record<string, PrivateResult>>({});
	let loading = $state(true);
	let busy = $state(false);
	let loadError = $state('');
	let recoveryError = $state('');
	let feedback = $state('');
	let deletion = $state<{ uri: string; status: 'confirm' | 'unknown' }>();
	let file = $state<File>();
	let title = $state('');
	let artist = $state('');
	let description = $state('');
	let tags = $state('');
	let consent = $state(false);
	let attempt: string | undefined;
	const active = $derived(pending.some(operation => !operation.archived));
	let fileInput = $state<HTMLInputElement>();

	onMount(() => {
		live = true;
		void refresh();
		return () => { live = false; generation++; };
	});

	async function refresh() {
		const version = ++generation;
		const [catalog, operations] = await Promise.allSettled([pds.list(), pds.pending()]);
		if (!current() || version !== generation) return;
		if (catalog.status === 'fulfilled') {
			tracks = catalog.value.tracks;
			cursor = catalog.value.cursor;
			loadError = '';
		} else {
			loadError = catalog.reason instanceof Error ? catalog.reason.message : 'could not load private music.';
		}
		if (operations.status === 'fulfilled') {
			pending = operations.value;
			recoveryError = '';
		} else {
			recoveryError = 'could not load creation recovery. try again before uploading.';
		}
		loading = false;
	}

	async function run(action: () => Promise<void>, reload = true) {
		if (!current() || busy) return;
		busy = true;
		feedback = '';
		try { await action(); }
		catch (error) { if (current()) feedback = error instanceof Error ? error.message : 'could not update private music.'; }
		finally {
			if (current()) {
				if (reload) await refresh();
				busy = false;
			}
		}
	}

	function play(track: Track) {
		if (player.privateMode && player.current?.record.uri === track.record.uri) player.toggle();
		else player.play(track, tracks);
	}

	function deleteTrack(track: Track, remove: boolean) {
		void run(async () => {
			try {
				const result = await (remove ? pds.deletion.remove(track) : pds.deletion.check(track));
				if (!current()) return;
				if (result === 'deleted') {
					player.forgetPrivateTrack(track.record.uri);
					tracks = tracks.filter(item => item.record.uri !== track.record.uri);
					deletion = undefined;
				} else {
					deletion = { uri: track.record.uri, status: 'confirm' };
					feedback = 'this track is still here. review it before deleting again.';
				}
			} catch (error) {
				if (current()) deletion = { uri: track.record.uri, status: 'unknown' };
				throw error;
			}
		}, false);
	}

	function reset(operation: PrivateCreate) {
		if (!current() || attempt !== operation.rkey) return;
		attempt = undefined;
		file = undefined;
		title = '';
		artist = '';
		description = '';
		tags = '';
		consent = false;
		if (fileInput) fileInput.value = '';
	}

	function upload() {
		const selected = file;
		if (!selected || !consent || active) return;
		void run(async () => {
			const duration = await fileDuration(selected);
			if (!current()) return;
			const result = await pds.upload({
				file: selected, duration, title, artist: artist.trim() || account.handle || '', description, tags: tags.split(/[\n,]+/)
			}, operation => { if (current()) attempt = operation.rkey; });
			if (current()) results[result.operation.rkey] = result.result;
		});
	}

	function loadMore() {
		const next = cursor;
		if (!next) return;
		void run(async () => {
			const page = await pds.list(next);
			if (!current()) return;
			const already = new Set(tracks.map(track => track.record.uri));
			tracks = [...tracks, ...page.tracks.filter(track => !already.has(track.record.uri))];
			cursor = page.cursor;
		}, false);
	}
</script>

<div class="private">
	<p class="subtle intro">these tracks live on your account’s server and only you can hear them.</p>
	{#if feedback}<p class="state" role="status">{feedback}</p>{/if}
	{#if player.privateMode && player.error}<p class="state" role="status">{player.error}</p>{/if}
	{#if loading}
		<Loading label="loading private music" inline />
	{:else if loadError}
		<p class="state" role="status">{loadError}</p>
		<button class="text-button" type="button" disabled={busy} onclick={() => run(refresh, false)}>try again</button>
		<a class="text-button" href="/login?return_to=%2Fprivate">sign in again</a>
	{:else if !tracks.length}
		<p class="state">no private tracks yet.</p>
	{/if}
	<ul>
		{#each tracks as track (track.record.uri)}
			<li>
				<div class="track">
					<button class="icon-button" type="button" aria-label={`${player.privateMode && player.current?.record.uri === track.record.uri && player.playing ? 'Pause' : 'Play'} ${track.metadata.title}`} onclick={() => play(track)}>
						<Icon name={player.privateMode && player.current?.record.uri === track.record.uri && player.playing ? 'pause' : 'play'} />
					</button>
					<div class="title"><strong>{track.metadata.title}</strong><span class="subtle">{artistName(track)}</span></div>
					<button class="icon-button" type="button" aria-label={`Delete ${track.metadata.title}`} disabled={busy || pending.some(operation => operation.uri === track.record.uri)}
						onclick={() => { deletion = { uri: track.record.uri, status: 'confirm' }; feedback = ''; }}><Icon name="trash" size={18} /></button>
				</div>
				{#if deletion?.uri === track.record.uri}
					<div class="confirm">
						<p>delete “{track.metadata.title}”? this deletes the current version, including edits made elsewhere.</p>
						{#if !account.privateDeleting}
							<a class="text-button" href="/login?return_to=%2Fprivate">sign in to delete private music</a>
						{:else if deletion.status === 'unknown'}
							<button class="text-button" disabled={busy} onclick={() => deleteTrack(track, false)}>check deletion</button>
						{:else}
							<button class="text-button danger" disabled={busy} onclick={() => deleteTrack(track, true)}>delete current track</button>
						{/if}
						<button class="text-button" disabled={busy} onclick={() => { deletion = undefined; }}>cancel</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	{#if cursor}<button class="text-button" disabled={busy} onclick={loadMore}>load more</button>{/if}

	{#if recoveryError}
		<p role="status" class="state">{recoveryError}</p>
		<button type="button" class="text-button" disabled={busy} onclick={() => run(refresh, false)}>retry recovery</button>
	{/if}
	{#each pending as operation (operation.rkey)}
		<section class="recovery">
			<h2>{typeof operation.record.title === 'string' ? operation.record.title : 'private creation'}</h2>
			<p class="subtle">
				{results[operation.rkey]?.state === 'accepted' ? 'saved in your private space.' : operation.archived ? 'earlier private attempt. it may still appear.' : 'private creation needs confirmation.'}
			</p>
			<button class="text-button" disabled={busy} onclick={() => run(async () => {
				const result = await pds.recover(operation);
				if (current()) results[operation.rkey] = result;
			})}>check private creation</button>
			{#if results[operation.rkey]?.state === 'accepted' || results[operation.rkey]?.state === 'different'}
				<button class="text-button" disabled={busy} onclick={() => run(async () => {
					await pds.dismiss(operation, results[operation.rkey]?.state === 'different');
					reset(operation);
				})}>{results[operation.rkey]?.state === 'different' ? 'keep existing private track' : 'done with private upload'}</button>
			{:else}
				<button class="text-button" disabled={busy} onclick={() => run(async () => {
					const result = await pds.recover(operation, true);
					if (current()) results[operation.rkey] = result;
				})}>resume private creation</button>
				{#if !operation.archived}<button class="text-button" disabled={busy} onclick={() => run(async () => { await pds.archive(operation, true); reset(operation); })}>set aside private creation</button>{/if}
			{/if}
		</section>
	{/each}

	<h2>upload privately</h2>
	{#if !account.privatePublishing}
		<a class="text-button" href="/login?return_to=%2Fprivate">sign in for private uploads</a>
	{:else}
		<form onsubmit={event => { event.preventDefault(); upload(); }}>
			<label for="private-audio">audio</label>
			<input id="private-audio" type="file" accept="audio/*" bind:this={fileInput} disabled={busy || active} onchange={event => {
				file = event.currentTarget.files?.[0];
				consent = false;
				if (file && !title) title = file.name.replace(/\.[^.]+$/, '').slice(0, 256);
			}} />
			<p class="subtle">up to 100 MiB</p>
			<label for="private-title">title</label>
			<input id="private-title" bind:value={title} maxlength="256" required disabled={busy || active} />
			<label for="private-artist">artist</label>
			<input id="private-artist" bind:value={artist} maxlength="256" placeholder={account.handle ?? ''} disabled={busy || active} />
			<label for="private-description">description</label>
			<textarea id="private-description" bind:value={description} maxlength="5000" rows="3" disabled={busy || active}></textarea>
			<label for="private-tags">tags</label>
			<input id="private-tags" bind:value={tags} placeholder="comma-separated" disabled={busy || active} />
			<label class="consent"><input type="checkbox" bind:checked={consent} disabled={busy || active} /> use my private space</label>
			<button class="text-button submit" type="submit" disabled={busy || active || loading || !!loadError || !!recoveryError || !file || !title.trim() || !consent}>
				{busy ? 'saving…' : 'upload privately'}
			</button>
		</form>
	{/if}
</div>

<style>
	.private { max-width: 46rem; }
	.intro { margin-block: 0.5rem 1.2rem; }
	ul { list-style: none; padding: 0; margin: 0 0 1.4rem; }
	li { border-bottom: 1px solid var(--line); }
	.track { display: flex; gap: 0.5rem; align-items: center; padding-block: 0.45rem; min-width: 0; }
	.title { display: grid; flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.confirm, .recovery { background: var(--surface); border: 1px solid var(--line); padding: 0.75rem; border-radius: 0.6rem; margin: 0.65rem 0 1rem; }
	h2 { font-size: 1.15rem; }
	.danger { color: var(--danger, #b12323); }
	form { margin-top: 0.75rem; display: grid; gap: 0.5rem; max-width: 32rem; }
	form input:not([type='checkbox']), textarea { width: 100%; padding: 0.6rem; border: 1px solid var(--line); border-radius: 0.5rem; color: inherit; background: var(--surface); font: inherit; font-size: 1rem; }
	form label { justify-self: start; margin-top: 0.4rem; }
	.submit { justify-self: start; background: var(--accent); color: var(--on-accent); padding-inline: 1rem; }
	.submit:hover { background: var(--accent); filter: brightness(1.12); }
</style>
