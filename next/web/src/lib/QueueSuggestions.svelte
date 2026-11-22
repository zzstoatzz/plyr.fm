<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { loadStarter, starters, suggestionRequest, type Starter } from '@plyr/next-core/queue-suggestions';
	import { api } from './api';
	import { auth } from './auth';
	import { player } from './player.svelte';
	import { artistName, trackHref } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let { empty }: { empty: boolean } = $props();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

	const current = $derived(player.current);
	let refresh = $state(0);
	let shown: string[] = [];
	let picks = $state.raw<Track[]>([]);
	let more = $state.raw<Track[]>([]);
	let added = $state.raw(new Set<string>());
	let moreName = $state('');

	// Refetch when the playing track changes or on refresh, not on every queue edit, so a + does not reshuffle the row under the finger.
	$effect(() => {
		const uri = current?.record.uri;
		const round = refresh;
		if (!uri || empty) { picks = []; return; }
		const controller = new AbortController();
		const timer = setTimeout(() => {
			const request = untrack(() => suggestionRequest(player.queue, player.index, round ? shown : []));
			if (!request) return;
			api.suggestions(request.seeds, { exclude: request.exclude, limit: 12, signal: controller.signal }).then(result => {
				picks = result.data;
				shown = [...result.data.map(track => track.record.uri), ...(round ? shown : [])].slice(0, 60);
			}, () => {});
		}, 300);
		return () => { clearTimeout(timer); controller.abort(); };
	});

	$effect(() => {
		const did = current?.artist.did;
		const name = current ? artistName(current) : '';
		if (!did || empty) { more = []; return; }
		const controller = new AbortController();
		api.tracks({ artist_did: did, limit: 13 }, controller.signal).then(result => {
			const queued = untrack(() => new Set(player.queue.map(track => track.id)));
			more = result.data.filter(track => !queued.has(track.id)).slice(0, 12);
			moreName = name;
		}, () => {});
		return () => controller.abort();
	});

	function add(track: Track) {
		player.enqueue(track, true);
		added = new Set([...added, track.id]);
	}

	// Starters: each stack loads its tracks up front so the tile shows real covers.
	type Loaded = { tracks: Track[]; label: string } | 'loading' | 'failed';
	const offered = $derived(starters(!!account.did));
	let stacks = $state<Record<string, Loaded>>({});
	let started = $state.raw(new Set<string>());
	let stacksFor: string | null | undefined;
	const pending: Record<string, number> = {};

	function load(starter: Starter) {
		const attempt = pending[starter.key] = (pending[starter.key] ?? 0) + 1;
		const settle = (value: Loaded) => { if (pending[starter.key] === attempt) stacks[starter.key] = value; };
		stacks[starter.key] = 'loading';
		loadStarter(api, starter.key, account.did ?? undefined).then(settle, () => settle('failed'));
	}

	$effect(() => {
		const did = account.did;
		if (!empty) return;
		untrack(() => {
			// A different account gets its own stacks, never the last one's.
			if (did !== stacksFor) { stacksFor = did; stacks = {}; started = new Set(); for (const key in pending) pending[key]++; }
			for (const starter of offered) if (!stacks[starter.key]) load(starter);
		});
	});

	function start(starter: Starter) {
		const stack = stacks[starter.key];
		if (typeof stack !== 'object' || !stack.tracks.length) return;
		if (player.current) player.enqueueCollection(stack.tracks);
		else player.play(stack.tracks[0], stack.tracks, stack.label);
		started = new Set([...started, starter.key]);
	}

	function covers(stack: Loaded | undefined) {
		return typeof stack === 'object' ? stack.tracks.slice(0, 4) : [];
	}
</script>

{#if empty}
	<section class="starters" aria-labelledby="queue-starters">
		<div class="glass note">
			<h2 id="queue-starters">nothing up next</h2>
			<p>{player.current ? 'add a stack and it plays after this one.' : 'pick a stack to start listening.'}</p>
		</div>
		<div class="tiles">
			{#each offered as starter, index (starter.key)}
				{@const stack = stacks[starter.key]}
				{#if stack !== 'failed' && !(typeof stack === 'object' && !stack.tracks.length)}
					<div class="tile" class:big={index === 0}>
						<button class="stack" type="button" tabindex="-1" aria-hidden="true" disabled={typeof stack !== 'object'} onclick={() => start(starter)}>
							{#each { length: 4 } as _, at (at)}
								{@const cover = covers(stack)[at]}
								<span class="cell">{#if cover}<Artwork src={trackArtwork(cover)} size={index === 0 ? 120 : 64} eager />{/if}</span>
							{/each}
						</button>
						<div class="tile-row">
							<div class="labels">
								<strong class="truncate">{starter.key === 'playlist' && typeof stack === 'object' ? stack.label : starter.title}</strong>
								<span class="subtle truncate">{typeof stack === 'object' ? `${stack.tracks.length} tracks · ${starter.subtitle}` : starter.subtitle}</span>
							</div>
							{#if starter.key === 'playlist'}
								<button class="icon-button" type="button" aria-label="Pick another playlist" title="pick another playlist" onclick={() => load(starter)}><Icon name="refresh" size={16} /></button>
							{/if}
							<button class="plus" class:done={started.has(starter.key)} type="button" aria-label={`${player.current ? 'Add' : 'Play'} ${starter.title}`} disabled={typeof stack !== 'object'} onclick={() => start(starter)}>
								<Icon name={started.has(starter.key) ? 'check' : player.current ? 'plus' : 'play'} size={16} />
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</section>
{:else}
	{#if picks.length}
		<section aria-labelledby="queue-suggested">
			<div class="strip-head">
				<h2 id="queue-suggested">add to your queue</h2>
				<button class="icon-button" type="button" aria-label="Show other suggestions" title="show other suggestions" onclick={() => { added = new Set(); refresh++; }}><Icon name="refresh" size={16} /></button>
			</div>
			{@render strip(picks)}
		</section>
	{/if}
	{#if more.length > 1}
		<section aria-labelledby="queue-more">
			<div class="strip-head"><h2 id="queue-more" class="truncate">more from {moreName}</h2></div>
			{@render strip(more)}
		</section>
	{/if}
{/if}

{#snippet strip(tracks: Track[])}
	<ul class="cards" role="list">
		{#each tracks as track (track.id)}
			{@const done = added.has(track.id)}
			<li class="card">
				<div class="art">
					<a href={trackHref(track)} tabindex="-1" aria-hidden="true"><Artwork src={trackArtwork(track)} size={120} /></a>
					<button class="plus" class:done type="button" disabled={done} aria-label={done ? `${track.metadata.title} added to queue` : `Add ${track.metadata.title} to queue`} title={done ? 'added' : 'add to queue'} onclick={() => add(track)}>
						<Icon name={done ? 'check' : 'plus'} size={16} />
					</button>
				</div>
				<a class="truncate title" href={trackHref(track)}>{track.metadata.title}</a>
				<a class="truncate subtle" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>
			</li>
		{/each}
	</ul>
{/snippet}

<style>
	h2 { color: var(--muted); font-size: var(--t-14); font-weight: 650; margin: 0; }
	.strip-head { display: flex; justify-content: space-between; align-items: center; min-height: 2.25rem; margin-block-end: 0.35rem; gap: 0.5rem; }
	.cards { display: flex; gap: 0.65rem; margin: 0; padding: 0 0 0.25rem; list-style: none; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; }
	.cards::-webkit-scrollbar { display: none; }
	.card { flex: none; width: 7.4rem; display: grid; gap: 0.1rem; scroll-snap-align: start; min-width: 0; }
	.art { position: relative; border-radius: 0.6rem; margin-block-end: 0.3rem; }
	.art a { display: block; border-radius: inherit; }
	.title { font-size: var(--t-13-6); font-weight: 650; }
	.subtle { font-size: var(--t-12); color: var(--faint); }
	.plus { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: none; border-radius: 50%; border: 0; padding: 0; color: var(--text); background: var(--surface); box-shadow: 0 0.25rem 0.7rem rgb(0 0 0 / 0.28); cursor: pointer; }
	.art .plus { position: absolute; z-index: 1; right: 0.35rem; bottom: 0.35rem; }
	.plus.done { background: var(--accent); color: var(--on-accent); }
	.plus:disabled:not(.done) { opacity: 0.5; cursor: default; }
	.starters { display: grid; gap: 0.75rem; }
	.glass { background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); border-radius: 0.9rem; }
	.note { padding: 0.85rem 0.95rem; }
	.note h2 { color: var(--text); font-size: var(--t-16); }
	.note p { margin: 0.2rem 0 0; color: var(--muted); font-size: var(--t-14); }
	.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; }
	.tile { display: grid; gap: 0.5rem; padding: 0.6rem; min-width: 0; border-radius: 0.9rem; border: 1px solid var(--line); background: var(--raised); }
	.tile.big, .tile:not(.big):nth-child(2):last-child { grid-column: 1 / -1; }
	.stack { display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; border: 0; padding: 0; border-radius: 0.6rem; background: var(--hover); cursor: pointer; aspect-ratio: 1; }
	.big .stack { grid-template-columns: repeat(4, 1fr); aspect-ratio: auto; }
	.cell { display: block; aspect-ratio: 1; background: var(--hover); }
	.tile-row { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
	.labels { flex: 1; min-width: 0; display: grid; gap: 0.05rem; }
	.labels strong { font-size: var(--t-14-4); }
	.labels span { font-size: var(--t-12); }
	.tile:not(.big) .labels span { display: none; }
	.tile .plus { box-shadow: none; border: 1.5px solid var(--line); background: transparent; }
	.tile .plus.done { border-color: var(--accent); background: var(--accent); }
	.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
