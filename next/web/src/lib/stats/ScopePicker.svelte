<script lang="ts">
	/** "stats for [everyone]": the page's scope. Type a name or handle to switch the whole page to that artist. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Artist, SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';

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
			<span class="pill on">
				<button type="button" class="who" aria-label={`stats for ${artist.display_name || artist.handle}, change artist`} onclick={edit}>
					<span class="avatar"><Artwork src={artist.avatar_url ?? undefined} size={36} fallbackIcon="user" /></span>
					<b class="truncate">{artist.display_name || artist.handle}</b>
					<span class="handle truncate">@{artist.handle}</span>
				</button>
				<a class="clear" href={resolve('/stats')} aria-label="back to stats for everyone"><Icon name="x" size={16} /></a>
			</span>
		{:else}
			<label class="pill" class:focus={editing}>
				<Icon name="search" size={20} />
				<input id="stat-artist" bind:this={input} type="search" bind:value={query} autocomplete="off" maxlength="100"
					placeholder="everyone" aria-label="stats for everyone, or type an artist's name or handle"
					role="combobox" aria-expanded={open && !!matches?.length} aria-controls="stat-artist-matches" aria-autocomplete="list"
					aria-activedescendant={open && matches?.length ? `stat-artist-${active}` : undefined}
					onfocus={() => { editing = true; }} onblur={() => setTimeout(() => { if (!query) editing = false; }, 150)} onkeydown={key} />
				{#if !editing && !query}<span class="hint">or type a handle</span>{/if}
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
	.scope { display: flex; align-items: center; gap: 0.6rem 1rem; min-width: 0; flex: 1 1 32rem; }
	h1 { font-size: clamp(1.9rem, 4.5vw, 2.75rem); line-height: 1; letter-spacing: -0.05em; white-space: nowrap; }
	.picker { position: relative; min-width: 0; flex: 0 1 26rem; }
	.pill { display: flex; align-items: center; gap: 0.55rem; min-height: 3rem; padding: 0.3rem 0.5rem 0.3rem 0.85rem; border-radius: 999px; border: 1px solid var(--line);
		background: color-mix(in srgb, var(--surface) 80%, transparent); color: var(--muted); cursor: text; min-width: 0; }
	.pill.focus, .pill:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
	.pill.on { padding-left: 0.3rem; color: var(--text); border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); cursor: default; }
	input { flex: 1; min-width: 6rem; border: 0; background: transparent; color: var(--text); font-size: max(16px, 1rem); font-weight: 700; padding: 0.35rem 0; outline: none; }
	input::placeholder { color: var(--text); }
	.pill.focus input::placeholder { color: var(--faint); font-weight: 400; }
	.hint { color: var(--faint); font-size: var(--t-14); white-space: nowrap; padding-right: 0.6rem; }
	.who { display: flex; align-items: center; gap: 0.55rem; min-width: 0; border: 0; padding: 0; background: transparent; color: inherit; text-align: left; }
	.who b { font-size: var(--t-17-6); }
	.handle { color: var(--faint); font-size: var(--t-14); }
	.avatar { flex: none; width: 2.25rem; border-radius: 50%; overflow: hidden; display: block; }
	li .avatar { width: 2.5rem; }
	.clear { display: grid; place-items: center; flex: none; width: 2.25rem; height: 2.25rem; margin-left: auto; border-radius: 50%; color: var(--faint); }
	.clear:hover { background: var(--hover); color: var(--text); }
	.menu { position: absolute; z-index: 20; top: calc(100% + 0.5rem); left: 0; width: min(26rem, calc(100vw - 2rem)); padding: 0.35rem; border-radius: 1rem;
		border: 1px solid var(--line); background: var(--surface); box-shadow: 0 14px 40px rgb(0 0 0 / 0.3); }
	.menu p { margin: 0; padding: 0.6rem 0.75rem; color: var(--muted); font-size: var(--t-14); }
	ul { list-style: none; margin: 0; padding: 0; }
	li button { display: flex; align-items: center; gap: 0.7rem; width: 100%; padding: 0.5rem 0.6rem; border: 0; border-radius: 0.7rem; background: transparent; color: var(--text); text-align: left; min-width: 0; }
	li button.active, li button:hover { background: var(--hover); }
	.match { display: grid; min-width: 0; }
	.match span { color: var(--faint); font-size: var(--t-13-6); }
	@media (max-width: 720px) { .scope { flex-wrap: wrap; } .picker { flex-basis: 100%; } .hint { display: none; } }
</style>
