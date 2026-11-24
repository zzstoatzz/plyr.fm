<script lang="ts">
	/** "stats for [everyone]": the page's scope. Type a name or handle to switch the whole page to that artist. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Artist, SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';

	let { artist }: { artist?: Pick<Artist, 'did' | 'handle' | 'display_name' | 'avatar_url'> } = $props();
	let query = $state('');
	let editing = $state(false);
	let matches = $state.raw<SearchHit[]>();
	let failed = $state(false);
	let active = $state(0);
	let input: HTMLInputElement | undefined = $state();
	const term = $derived(query.trim().replace(/^@/, ''));
	const open = $derived(editing && [...term].length >= 2);

	$effect(() => {
		const value = term;
		matches = undefined;
		failed = false;
		active = 0;
		if ([...value].length < 2) return;
		const request = new AbortController();
		const timer = setTimeout(() => {
			void api.search(value, { types: 'artist', limit: 6, signal: request.signal }).then(
				({ data }) => { if (!request.signal.aborted) matches = data; },
				() => { if (!request.signal.aborted) failed = true; }
			);
		}, 160);
		return () => { clearTimeout(timer); request.abort(); };
	});

	function pick(match: SearchHit) {
		query = '';
		editing = false;
		input?.blur();
		void goto(resolve(`/stats?${new URLSearchParams({ artist: match.owner.handle })}`));
	}
	function key(event: KeyboardEvent) {
		if (event.key === 'Escape') { query = ''; editing = false; return; }
		if (!matches?.length) return;
		if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % matches.length; }
		else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + matches.length) % matches.length; }
		else if (event.key === 'Enter') { event.preventDefault(); pick(matches[active]); }
	}
	async function edit() {
		editing = true;
		await Promise.resolve();
		input?.focus();
	}
</script>

<div class="scope">
	<h1>stats for</h1>
	<div class="picker">
		{#if artist && !editing}
			<span class="current">
				<button type="button" class="who" aria-label={`stats for ${artist.display_name || artist.handle}, change artist`} onclick={edit}>
					<span class="avatar"><Artwork src={artist.avatar_url ?? undefined} size={40} fallbackIcon="user" /></span>
					<span class="word truncate">{artist.display_name || artist.handle}</span>
				</button>
				<a class="back" href={resolve('/stats')}>back to everyone</a>
			</span>
		{:else}
			<label class="field" class:focus={editing}>
				<input id="stat-artist" bind:this={input} type="search" bind:value={query} autocomplete="off" maxlength="100"
					placeholder="everyone" aria-label="stats for everyone, or type an artist's name or handle"
					role="combobox" aria-expanded={open && !!matches?.length} aria-controls="stat-artist-matches" aria-autocomplete="list"
					aria-activedescendant={open && matches?.length ? `stat-artist-${active}` : undefined}
					onfocus={() => { editing = true; }} onblur={() => setTimeout(() => { if (!query) editing = false; }, 150)} onkeydown={key} />
				{#if !query}<span class="hint">{editing ? 'type a name or handle' : 'or type a handle'}</span>{/if}
			</label>
		{/if}
		{#if open}
			<div class="menu">
				{#if failed}
					<p role="alert">couldn’t search artists right now.</p>
				{:else if matches?.length}
					<ul id="stat-artist-matches" role="listbox" aria-label="matching artists">
						{#each matches as match, index (match.id)}
							<li id="stat-artist-{index}" role="option" aria-selected={index === active}>
								<button type="button" tabindex="-1" class:active={index === active} onpointerdown={event => event.preventDefault()} onclick={() => pick(match)}>
									<span class="avatar"><Artwork src={match.image_url ?? undefined} size={40} fallbackIcon="user" /></span>
									<span class="match"><b class="truncate">{match.title}</b><span class="truncate">@{match.owner.handle}</span></span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if matches}
					<p role="status">no artists found for “{term}”.</p>
				{:else}
					<p role="status">finding artists…</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.scope { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.6rem; min-width: 0; flex: 1 1 32rem; }
	h1, .word, input { font-size: clamp(2.1rem, 4.6vw, 2.9rem); font-weight: 800; line-height: 1.15; letter-spacing: -0.04em; }
	h1 { white-space: nowrap; }
	.picker { position: relative; min-width: 0; flex: 0 1 auto; }
	.word { text-decoration-line: underline; text-decoration-thickness: 3px; text-underline-offset: 0.5rem; text-decoration-color: color-mix(in srgb, var(--accent) 70%, transparent); }
	.field { display: flex; align-items: baseline; gap: 0.3rem 0.75rem; flex-wrap: wrap; cursor: text; }
	input { width: 6.4ch; field-sizing: content; min-width: 4ch; max-width: 100%; border: 0; border-bottom: 3px solid color-mix(in srgb, var(--accent) 70%, transparent); border-radius: 0; padding: 0 0 0.15rem; background: transparent; color: var(--text); font-family: inherit; outline: none; }
	input::placeholder { color: var(--text); opacity: 1; }
	.field.focus input { min-width: min(12ch, 70vw); border-bottom-color: var(--accent); }
	.field.focus input::placeholder { color: var(--faint); }
	input::-webkit-search-cancel-button { display: none; }
	.hint { color: var(--faint); font-size: var(--t-16); white-space: nowrap; }
	.current { display: flex; align-items: baseline; gap: 0.3rem 1rem; flex-wrap: wrap; min-width: 0; }
	.who { display: inline-flex; align-items: center; gap: 0.6rem; min-width: 0; max-width: 100%; border: 0; padding: 0; background: transparent; color: var(--text); text-align: left; }
	.avatar { flex: none; width: 2.5rem; border-radius: 50%; overflow: hidden; display: block; }
	.back { color: var(--accent); font-size: var(--t-16); white-space: nowrap; }
	.menu { position: absolute; z-index: 20; top: calc(100% + 0.6rem); left: 0; width: min(26rem, calc(100vw - 2rem)); padding: 0.3rem; border-radius: 0.4rem;
		border: 1px solid var(--line); background: var(--surface); box-shadow: 0 14px 40px rgb(0 0 0 / 0.3); }
	.menu p { margin: 0; padding: 0.6rem 0.75rem; color: var(--muted); font-size: var(--t-14); }
	ul { list-style: none; margin: 0; padding: 0; }
	li button { display: flex; align-items: center; gap: 0.7rem; width: 100%; padding: 0.5rem 0.6rem; border: 0; border-radius: 0.25rem; background: transparent; color: var(--text); text-align: left; min-width: 0; }
	li button.active, li button:hover { background: var(--hover); }
	.match { display: grid; min-width: 0; }
	.match b { font-size: var(--t-15); }
	.match span { color: var(--faint); font-size: var(--t-13-6); }
	@media (max-width: 720px) { .picker { flex-basis: 100%; } }
</style>
