<script lang="ts">
	import { page } from '$app/state';
	import { api, type SearchHit } from '$lib/api';

	let hits = $state<SearchHit[]>([]);
	let error = $state<string | null>(null);
	const q = $derived(page.url.searchParams.get('q') ?? '');

	$effect(() => {
		const query = q;
		hits = [];
		error = null;
		if (!query) return;
		api.search(query).then((r) => (hits = r.data)).catch((e) => (error = e.message));
	});

	function href(hit: SearchHit) {
		switch (hit.type) {
			case 'track':
				return `/track/${hit.id}`;
			case 'artist':
				return `/u/${hit.owner.handle}`;
			case 'album':
				return `/album/${hit.id}`;
			case 'playlist':
				return `/playlist/${hit.id}`;
		}
	}
</script>

<h1>search{q ? `: ${q}` : ''}</h1>
{#if error}<p class="error">{error}</p>{/if}
{#each hits as hit (hit.type + hit.id)}
	<a class="card" href={href(hit)}>
		<span class="muted">{hit.type}</span> · {hit.title}
		{#if hit.type !== 'artist'}<span class="muted">· {hit.owner.display_name || hit.owner.handle}</span>{/if}
	</a>
{:else}
	{#if q && !error}<p class="muted">no results.</p>{/if}
{/each}
