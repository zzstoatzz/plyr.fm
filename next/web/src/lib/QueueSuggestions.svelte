<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { resolve } from '$app/paths';
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { starters, type Starter } from '@plyr/next-core/queue-suggestions';
	import type { StackState } from '@plyr/next-core/queue-suggestion-store';
	import { auth } from './auth';
	import { player } from './player.svelte';
	import { queueSuggestions } from './queue-suggestions';
	import { artistName, trackHref } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let { empty }: { empty: boolean } = $props();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	let store = $state.raw(queueSuggestions.snapshot());
	onMount(() => queueSuggestions.subscribe(() => { store = queueSuggestions.snapshot(); }));

	// The strips live in a session store: reopening the queue on the same track shows them as they were and asks for nothing.
	$effect(() => {
		const uri = player.current?.record.uri;
		const artistDid = player.current?.artist.did;
		if (empty || !uri) return;
		const name = untrack(() => player.current ? artistName(player.current) : '');
		queueSuggestions.follow({ uri, artistDid, artistName: name, queue: () => ({ queue: player.queue, index: player.index }) });
	});

	// An added card leaves the strip (in both strips, if it sits in both) instead of staying as a checkmark.
	const shownPicks = $derived(store.picks.filter(track => !store.added.has(track.id)));
	const shownMore = $derived(store.more.filter(track => !store.added.has(track.id)));
	const leaving = new Set<string>();

	function add(track: Track, button: HTMLButtonElement) {
		player.enqueue(track, true);
		leaving.add(track.id);
		// Keep a keyboard user in the strip: focus moves to the card that slides into this one's place.
		if (document.activeElement === button) {
			const card = button.closest('li');
			const next = card?.nextElementSibling ?? card?.previousElementSibling;
			next?.querySelector<HTMLButtonElement>('.plus')?.focus();
		}
		queueSuggestions.added(track.id);
	}

	/** The added card shrinks away and its neighbours close the gap; any other card that leaves (a refresh) just goes. */
	function leave(node: HTMLElement, id: string) {
		if (!leaving.has(id) || matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
		const width = node.offsetWidth;
		const gap = parseFloat(getComputedStyle(node.parentElement ?? node).columnGap) || 0;
		return { duration: 240, easing: cubicOut, css: (t: number, u: number) => `overflow: hidden; width: ${t * width}px; margin-inline-end: ${-u * gap}px; opacity: ${t}; transform: scale(${0.85 + 0.15 * t});` };
	}

	// Starters: each stack loads its tracks up front so the tile shows real covers, and keeps them for the next time the queue empties.
	const offered = $derived(starters(!!account.did));
	$effect(() => {
		const did = account.did;
		if (empty) queueSuggestions.showStacks(did);
	});

	function start(starter: Starter) {
		const stack = store.stacks[starter.key];
		if (typeof stack !== 'object' || !stack.tracks.length) return;
		if (player.current) player.enqueueCollection(stack.tracks);
		else player.play(stack.tracks[0], stack.tracks, stack.label);
		queueSuggestions.started(starter.key);
	}

	function covers(stack: StackState | undefined) {
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
				{@const stack = store.stacks[starter.key]}
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
								<button class="icon-button" type="button" aria-label="Pick another playlist" title="pick another playlist" onclick={() => queueSuggestions.reloadStack(starter.key)}><Icon name="refresh" size={16} /></button>
							{/if}
							<button class="plus" class:done={store.started.has(starter.key)} type="button" aria-label={`${player.current ? 'Add' : 'Play'} ${starter.title}`} disabled={typeof stack !== 'object'} onclick={() => start(starter)}>
								<Icon name={store.started.has(starter.key) ? 'check' : player.current ? 'plus' : 'play'} size={16} />
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</section>
{:else}
	{#if shownPicks.length}
		<section aria-labelledby="queue-suggested">
			<div class="strip-head">
				<h2 id="queue-suggested">add to your queue</h2>
				<button class="icon-button" type="button" aria-label="Show other suggestions" title="show other suggestions" onclick={() => queueSuggestions.refresh()}><Icon name="refresh" size={16} /></button>
			</div>
			{@render strip(shownPicks)}
		</section>
	{/if}
	{#if store.more.length > 1 && shownMore.length}
		<section aria-labelledby="queue-more">
			<div class="strip-head"><h2 id="queue-more" class="truncate">more from {store.moreName}</h2></div>
			{@render strip(shownMore)}
		</section>
	{/if}
{/if}

{#snippet strip(tracks: Track[])}
	<ul class="cards" role="list">
		{#each tracks as track (track.id)}
			<li class="card" out:leave={track.id}>
				<div class="art">
					<a href={trackHref(track)} tabindex="-1" aria-hidden="true"><Artwork src={trackArtwork(track)} size={120} /></a>
					<button class="plus" type="button" aria-label={`Add ${track.metadata.title} to queue`} title="add to queue" onclick={event => add(track, event.currentTarget)}>
						<Icon name="plus" size={16} />
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
