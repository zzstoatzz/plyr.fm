<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { resolveHandle } from '@plyr/next-core/auth-state';
	import { pdsEndpoint, pdsSupportsSpaces } from '@plyr/next-core/identity';
	import { JamAccessDenied, JamNotStarted, parseJamTrackSnapshot, type InitialJam } from '@plyr/next-core/jam-space';
	import { api } from '$lib/api';
	import { auth, login } from '$lib/auth';
	import { isJamDid, jamRoomPath, parseJamRoom, takeJamStart } from '$lib/jam-room';
	import { audioDuration } from '$lib/media/file-duration';
	import { playbackSource } from '$lib/media/playback-source';
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
	const joinAfterLogin = $derived(page.url.searchParams.get('join') === '1');
	const loginReturn = $derived(link + (trackId ? '&' : '?') + 'join=1');
	const host = $derived(!!room && room.host === account.did);
	const currentJam = $derived(player.jam && player.jam.host === room?.host && player.jam.key === room.key ? player.jam : undefined);
	const support = $derived.by(() => {
		supportAttempt;
		return room && account.did && !account.jamSpace ? pdsEndpoint(account.did).then(pdsSupportsSpaces) : undefined;
	});
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	$effect(() => {
		if (!room || !trackId || !host || !account.jamSpace || !takeJamStart(room)) return;
		untrack(() => { void enter(true, true); });
	});
	$effect(() => {
		if (!room || !account.did || !account.jamSpace || !joinAfterLogin || busy) return;
		untrack(() => {
			const url = new URL(page.url);
			const slug = page.params.room;
			const agent = account.agent;
			url.searchParams.delete('join');
			void goto(url, { replaceState: true, keepFocus: true, noScroll: true }).then(() => {
				if (page.params.room === slug && account.agent === agent && !host && !currentJam) void enter(false);
			}, () => {});
		});
	});

	async function run(action: (check: () => void) => Promise<void>, errorCopy: string) {
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
				if (error instanceof JamNotStarted) failure = 'the host hasn’t started this jam yet.';
				else if (error instanceof JamAccessDenied) failure = 'check that the host invited this account.';
				else failure = errorCopy;
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
		const checkAccount = () => {
			if (auth.getAuth().agent !== agent) throw new Error('account changed.');
		};
		return {
			space,
			async enter(initial?: InitialJam, recover?: () => Promise<InitialJam>) {
				const admit = async () => {
					checkAccount();
					try { return await joinJam({ agent }, activeRoom.host, activeRoom.key, initial); }
					catch (error) { if (!recover || !(error instanceof JamNotStarted)) throw error; }
					const fallback = await recover();
					checkAccount();
					return joinJam({ agent }, activeRoom.host, activeRoom.key, fallback);
				};
				let admission = did === activeRoom.host ? undefined : await admit();
				return player.joinJam(activeRoom, async () => {
					const ticket = admission;
					admission = undefined;
					return ticket ?? admit();
				}, check);
			}
		};
	}

	function enter(create: boolean, fromQueue = false) {
		return run(async check => {
			if (player.privateMode) throw new Error('play a public track before joining a jam.');
			const current = player.current;
			const capture = current && (!trackId || fromQueue || current.id === trackId) && !player.liveStation
				? { current, tracks: player.queue, index: player.index, duration: player.length || player.duration, position: player.position, playing: player.playing }
				: undefined;
			const activeRoom = room;
			if (!activeRoom) return;
			const client = await roomClient(check);
			if (!host) { await client.enter(); return; }
			const { jamTrack } = await import('@plyr/next-core/jam-playback');
			async function recover(value?: unknown) {
				const snapshot = parseJamTrackSnapshot(value ?? await client.space.read());
				const track = await api.track(snapshot.trackId);
				let ref = jamTrack(track, capture?.current.id === track.id ? capture.duration : undefined);
				if (!ref && track.record.cid === snapshot.cid && !track.access.space_uri && !track.access.gate && track.access.visibility !== 'private') {
					const source = await playbackSource(track, AbortSignal.timeout(8000));
					try { ref = jamTrack(track, await audioDuration(source.url)); }
					finally { source.release?.(); }
				}
				if (!ref || ref.cid !== snapshot.cid) throw new Error('couldn’t restore the jam’s track.');
				return { queue: [ref], index: 0, playing: snapshot.playing, positionMs: Math.min(ref.durationMs, snapshot.positionMs) };
			}
			if (create) {
				const track = capture?.current ?? (trackId ? await api.track(trackId) : undefined);
				const ref = track && jamTrack(track, capture?.duration);
				if (!ref) throw new Error('track cannot be shared');
				const before = capture?.tracks.slice(0, capture.index).flatMap(item => jamTrack(item) ?? []) ?? [];
				const after = capture?.tracks.slice(capture.index + 1).flatMap(item => jamTrack(item) ?? []) ?? [];
				const queue = [...before, ref, ...after];
				const positionMs = Math.min(ref.durationMs, Math.max(0, Math.round((capture?.position ?? 0) * 1000)));
				const playing = capture?.playing ?? false;
				check();
				const created = await client.space.create();
				check();
				const previous = created ? undefined : await client.space.read(true);
				check();
				if (previous === undefined) {
					await client.space.publish({ revision: 0, trackId: ref.id, cid: ref.cid, playing, positionMs, updatedAtMs: Date.now() });
					check();
					await client.enter({ queue, index: before.length, playing, positionMs });
				} else await client.enter(undefined, () => recover(previous));
				check();
				await goto(jamRoomPath(activeRoom.host, activeRoom.key), { replaceState: true, keepFocus: true, noScroll: true });
				if (capture && queue.length < capture.tracks.length) notice = 'some tracks couldn’t be shared.';
			} else await client.enter(undefined, recover);
		}, create ? 'couldn’t start the jam. try again.' : 'couldn’t join the jam. try again.');
	}

	function invite() {
		const handle = guest.trim().replace(/^@/, '');
		if (!handle) return;
		return run(async check => {
			const did = isJamDid(handle) ? handle : await resolveHandle(handle);
			if (typeof did !== 'string' || !isJamDid(did)) {
				failure = 'couldn’t find that account. check the handle.';
				return;
			}
			check();
			const { space } = await roomClient(check);
			await space.invite(did);
			check();
			notice = 'guest invited. send them the jam link.';
		}, 'couldn’t invite this guest. try again.');
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
		<a class="text-button" href={'/login?return_to=' + encodeURIComponent(loginReturn)}>sign in to join</a>
	{:else if !account.jamSpace}
		{#await support}
			<Loading label="checking jam support" inline />
		{:then supported}
			{#if supported}
				<p>allow plyr.fm to create and join jams with this account.</p>
				<button class="text-button" type="button" disabled={busy} onclick={() => run(async () => {
					if (account.did) await login(account.did, false, joinAfterLogin ? loginReturn : link);
				}, 'couldn’t open sign-in. try again.')}>enable jams</button>
			{:else}<p>your account’s server doesn’t support jams yet.</p>{/if}
		{:catch}
			<p role="alert">could not check jam support.</p>
			<button class="text-button" type="button" onclick={() => supportAttempt++}>try again</button>
		{/await}
	{:else if !currentJam}
		<div class="actions">
			{#if host && trackId}
				<button class="text-button" type="button" disabled={busy} onclick={() => enter(true)}>{busy ? 'starting jam…' : 'start jam'}</button>
			{:else}
				<button class="text-button" type="button" disabled={busy} onclick={() => enter(false)}>{busy && !host ? 'joining jam…' : 'join jam'}</button>
			{/if}
		</div>
	{:else}
		<p role="status">{currentJam.phase === 'connected' ? 'jam is live' : currentJam.phase === 'reconnecting' ? 'reconnecting to the jam…' : 'connecting to the jam…'}</p>
		{#if currentJam.state}
			<div class="actions">
				<button class="text-button" type="button" disabled={currentJam.phase !== 'connected'} onclick={() => player.jamCommand({ action: currentJam?.state?.playing ? 'pause' : 'play' })}>{currentJam.state.playing ? 'pause jam' : 'play jam'}</button>
				{#if host}
					<button class="text-button" type="button" disabled={!player.canSeek} onclick={() => player.seek(0)}>seek to start</button>
				{/if}
				{#if currentJam.state.playing && !player.playing && !player.loading}
					<button class="text-button" type="button" onclick={() => player.jamCommand({ action: 'play' })}>play audio on this device</button>
				{/if}
			</div>
		{/if}
		{#if host && currentJam.phase === 'connected'}
			<form onsubmit={(event) => { event.preventDefault(); void invite(); }}>
				<label for="jam-guest">guest handle</label>
				<input id="jam-guest" bind:value={guest} placeholder="you.bsky.social" autocomplete="off" autocapitalize="none" spellcheck={false} />
				<div class="actions">
					<button class="text-button" type="submit" disabled={busy || !guest.trim()}>invite guest</button>
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
	input { min-width: 0; min-height: 2.75rem; border: 1px solid var(--line); border-radius: 0.6rem; padding: 0 0.75rem; background: var(--surface); color: inherit; }
	.text-button { border: 1px solid var(--line); border-radius: 2rem; }
</style>
