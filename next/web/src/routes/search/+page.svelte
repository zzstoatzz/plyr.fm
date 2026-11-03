<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type SearchHit } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';

	let q = $state(page.url.searchParams.get('q') ?? '');
	let hits = $state<SearchHit[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	// search as you type, debounced; the url keeps the query for back/share
	$effect(() => {
		const term = q.trim();
		clearTimeout(timer);
		if (!term) {
			hits = [];
			return;
		}
		timer = setTimeout(async () => {
			const mine = ++seq;
			loading = true;
			error = null;
			try {
				const res = await api.search(term);
				if (mine === seq) hits = res.data;
			} catch (e) {
				if (mine === seq) error = (e as Error).message;
			} finally {
				if (mine === seq) loading = false;
			}
			goto(`/search?q=${encodeURIComponent(term)}`, { replaceState: true, keepFocus: true, noScroll: true });
		}, 220);
	});

	const href = (h: SearchHit) =>
		h.type === 'track' ? `/track/${h.id}` : h.type === 'artist' ? `/u/${h.owner.handle}` : `/${h.type}/${h.id}`;
	const groups = $derived(
		(['track', 'artist', 'album', 'playlist'] as const)
			.map((type) => ({ type, items: hits.filter((h) => h.type === type) }))
			.filter((g) => g.items.length)
	);
</script>

<div class="bar">
	<label class="box">
		<Icon name="search" size={18} />
		<!-- svelte-ignore a11y_autofocus -->
		<input type="search" bind:value={q} placeholder="search tracks, artists, playlists" aria-label="search" autofocus enterkeyhint="search" />
	</label>
</div>

{#if error}<p class="error pad">{error}</p>{/if}
{#each groups as g (g.type)}
	<h2 class="section">{g.type}s</h2>
	<ul class="plain">
		{#each g.items as h (h.type + h.id)}
			<li>
				<a class="row-item" href={href(h)}>
					<Artwork src={h.image_url} seed={h.title} size={44} round={h.type === 'artist'} />
					<span class="grow">
						<span class="ellipsis" style="display:block;font-weight:600">{h.title}</span>
						{#if h.type !== 'artist'}<span class="muted small ellipsis" style="display:block">{h.owner.display_name || h.owner.handle}</span>
						{:else}<span class="muted small">@{h.owner.handle}</span>{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	{#if q.trim() && !loading && !error}
		<p class="empty">nothing found for "{q.trim()}".</p>
	{:else if !q.trim()}
		<p class="empty">find tracks, artists, albums and playlists.</p>
	{/if}
{/each}

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		padding: var(--s-sm) var(--s-lg);
		padding-top: max(var(--s-sm), env(safe-area-inset-top));
		background: var(--c-0);
		border-bottom: 1px solid var(--c-50);
	}
	.box {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		height: 40px;
		padding: 0 var(--s-md);
		border-radius: var(--r-full);
		background: var(--c-50);
		color: var(--c-600);
	}
	.box:focus-within {
		outline: 2px solid var(--accent);
	}
	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		outline: none;
		color: var(--c-1000);
		font-size: 16px;
	}
</style>
