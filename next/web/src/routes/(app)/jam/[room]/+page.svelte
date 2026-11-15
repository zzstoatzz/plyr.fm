<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { pdsEndpoint, pdsSupportsSpaces } from '@plyr/next-core/identity';
	import { parseJamTrackSnapshot, type InitialJam } from '@plyr/next-core/jam-space';
	import { api } from '$lib/api';
	import { auth, login } from '$lib/auth';
	import { isJamDid, jamRoomPath, parseJamRoom } from '$lib/jam-room';
	import { player } from '$lib/player.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let account = $state.raw(auth.getAuth());
	let guest = $state('');
	let busy = $state(false);
	let failure = $state('');
	let notice = $state('');
	let supportAttempt = $state(0);
	const room = $derived(parseJamRoom(page.params.room ?? ''));
	const trackId = $derived(page.url.searchParams.get('track') ?? undefined);
	const link = $derived(room ? jamRoomPath(room.host, room.key, trackId) : '/');
	const host = $derived(!!room && room.host === account.did);
	const currentJam = $derived(player.jam && player.jam.host === room?.host && player.jam.key === room.key ? player.jam : undefined);
	const support = $derived.by(() => {
		supportAttempt;
		return room && account.did && !account.jamSpace ? pdsEndpoint(account.did).then(pdsSupportsSpaces) : undefined;
	});
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

	async function run(action: (check: () => void) => Promise<void>) {
		if (busy) return;
		const initial = { slug: page.params.room, agent: account.agent };
		const check = () => {
			if (page.params.room !== initial.slug || auth.getAuth().agent !== initial.agent) throw new Error('room or account changed.');
		};
		busy = true;
		failure = '';
		notice = '';
		try { await action(check); }
		catch (error) {
			if (page.params.room === initial.slug && auth.getAuth().agent === initial.agent) {
				failure = error instanceof Error ? error.message : 'jam request failed.';
			}
		} finally { busy = false; }
	}

	async function roomClient(check: () => void) {
		const activeRoom = room;
		const { did, agent } = account;
		if (!activeRoom || !did || !agent) throw new Error('sign in to join this jam.');
		const [{ jamSpace, joinJam }, { P256Keypair }] = await Promise.all([import('$lib/jam-space'), import('@atproto/crypto')]);
		check();
		const space = jamSpace(agent, did, activeRoom.host, activeRoom.key, {
			fetch: (url, init) => fetch(url, init),
			keypair: () => P256Keypair.create()
		});
		return {
			space,
			enter: (initial?: InitialJam) => player.joinJam(activeRoom, () => {
				if (auth.getAuth().agent !== agent) return Promise.reject(new Error('account changed. try again.'));
				return joinJam({ agent }, activeRoom.host, activeRoom.key, initial);
			}, check)
		};
	}

	function enter(create: boolean) {
		return run(async check => {
			if (player.privateMode) throw new Error('play a public track before joining a jam.');
			const client = await roomClient(check);
			if (!host) { await client.enter(); return; }
			const { jamTrack } = await import('@plyr/next-core/jam-playback');
			if (create) {
				const track = trackId ? await api.track(trackId) : player.current;
				const ref = track && jamTrack(track);
				if (!track || !ref) throw new Error('choose a track with audio before starting a jam.');
				check();
				await client.space.create();
				check();
				await client.space.publish({ revision: 0, trackId: track.id, cid: ref.cid, playing: false, positionMs: 0, updatedAtMs: Date.now() });
				check();
				await client.enter({ queue: [ref], index: 0, playing: false, positionMs: 0 });
			} else {
				const snapshot = parseJamTrackSnapshot(await client.space.read());
				const track = await api.track(snapshot.trackId);
				const ref = jamTrack(track);
				if (!ref || ref.cid !== snapshot.cid) throw new Error('the jam track has changed.');
				check();
				await client.enter({ queue: [ref], index: 0, playing: snapshot.playing, positionMs: Math.min(ref.durationMs, snapshot.positionMs) });
			}
		});
	}

	function invite() {
		const did = guest.trim();
		if (!isJamDid(did)) return;
		return run(async check => {
			const { space } = await roomClient(check);
			await space.invite(did);
			check();
			notice = 'guest invited. send them the jam link.';
		});
	}

	async function copyLink() {
		if (!room) return;
		try {
			await navigator.clipboard.writeText(new URL(jamRoomPath(room.host, room.key), location.origin).href);
			notice = 'jam link copied.';
		} catch { failure = 'could not copy the jam link. you can share this page’s address.'; }
	}
</script>

<svelte:head><title>jam room · plyr.fm</title></svelte:head>

<section class="page-content jam">
	<h1>jam room</h1>
	{#if !room}
		<p role="alert">this jam link is invalid.</p>
	{:else if !account.ready}
		<Loading label="checking sign-in" inline />
	{:else if !account.did}
		<a class="text-button" href={'/login?return_to=' + encodeURIComponent(link)}>sign in to join</a>
	{:else if !account.jamSpace}
		{#await support}
			<Loading label="checking jam support" inline />
		{:then supported}
			{#if supported}
				<p>allow plyr.fm to create and join jams with this account.</p>
				<button class="text-button" type="button" disabled={busy} onclick={() => run(async () => {
					if (account.did) await login(account.did, false, link);
				})}>enable jams</button>
			{:else}<p>your account’s server doesn’t support jams yet.</p>{/if}
		{:catch}
			<p role="alert">could not check jam support.</p>
			<button class="text-button" type="button" onclick={() => supportAttempt++}>try again</button>
		{/await}
	{:else if !currentJam}
		<div class="actions">
			{#if host && (trackId || player.current)}
				<button class="text-button" type="button" disabled={busy} onclick={() => enter(true)}>create jam with current track</button>
			{/if}
			<button class="text-button" type="button" disabled={busy} onclick={() => enter(false)}>join jam</button>
		</div>
	{:else}
		<p role="status">{currentJam.phase === 'connected' ? 'connected' : 'connecting to the jam…'}</p>
		{#if currentJam.state}
			<p>{currentJam.state.playing ? 'playing' : 'paused'}</p>
			<div class="actions">
				<button class="text-button" type="button" disabled={currentJam.phase !== 'connected'} onclick={() => player.jamCommand({ action: currentJam?.state?.playing ? 'pause' : 'play' })}>{currentJam.state.playing ? 'pause jam' : 'play jam'}</button>
				{#if host}
					<button class="text-button" type="button" disabled={!player.canSeek} onclick={() => player.seek(0)}>seek to start</button>
				{/if}
				{#if currentJam.state.playing && !player.playing && !player.loading}
					<button class="text-button" type="button" onclick={() => player.jamCommand({ action: 'play' })}>play audio on this device</button>
				{/if}
			</div>
			{#if !host}<p class="subtle">the host controls seeking. everyone can play, pause and edit the queue.</p>{/if}
		{/if}
		{#if host}
			<form onsubmit={(event) => { event.preventDefault(); void invite(); }}>
				<label for="jam-guest">guest DID</label>
				<input id="jam-guest" bind:value={guest} autocomplete="off" autocapitalize="none" spellcheck={false} />
				<div class="actions">
					<button class="text-button" type="submit" disabled={busy || !isJamDid(guest.trim())}>invite guest</button>
					<button class="text-button" type="button" onclick={copyLink}>copy jam link</button>
				</div>
			</form>
		{/if}
		<button class="text-button" type="button" onclick={() => player.leaveJam()}>leave jam</button>
		{#if currentJam.error}<p role="alert">{currentJam.error}</p>{/if}
	{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if failure}<p role="alert">{failure}</p>{/if}
</section>

<style>
	.jam { display: grid; justify-items: start; gap: 1rem; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	form { display: grid; gap: 0.5rem; width: min(100%, 26rem); }
	input { min-width: 0; min-height: 2.75rem; border: 1px solid var(--line); border-radius: 0.6rem; padding: 0 0.75rem; font-size: 1rem; background: var(--surface); color: inherit; }
	.text-button { border: 1px solid var(--line); border-radius: 2rem; }
</style>
