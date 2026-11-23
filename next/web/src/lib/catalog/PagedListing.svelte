<script lang="ts" module>
  import { createCatalogPages } from '@plyr/next-core/catalog/pages';

  type Source = { load: (cursor?: string) => Promise<unknown>; version: number };
  type Kept = { pager: ReturnType<typeof createCatalogPages<unknown>>; source: Source };
  // A list you come back to (Back from a track, the tab again) keeps the pages it had loaded, so the browser
  // can put you back where you were instead of at the top of page one, the way home and artist pages do.
  const recent = new Map<string, Kept>();

  function keep(key: string | undefined, source: Source): Kept {
    const kept = key ? recent.get(key) : undefined;
    if (kept) return touch(key, kept);
    const entry: Kept = { source, pager: createCatalogPages<unknown>(cursor => entry.source.load(cursor) as never, () => entry.source.version) };
    return touch(key, entry);
  }

  function touch(key: string | undefined, entry: Kept) {
    if (key) {
      recent.delete(key);
      recent.set(key, entry);
      const oldest = recent.keys().next().value;
      if (recent.size > 8 && oldest !== undefined) recent.delete(oldest);
    }
    return entry;
  }
</script>

<script lang="ts" generics="T">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Page } from '@plyr/next-core/api';
  import Loading from '$lib/ui/Loading.svelte';
  import LoadMore from '$lib/ui/LoadMore.svelte';

  let { load, items, empty, label, version = 0, key }: {
    load: (cursor?: string) => Promise<Page<T>>;
    items: Snippet<[T[]]>;
    empty: string;
    label: string;
    version?: number;
    /** Names the list so coming back to it keeps its loaded pages; leave it out for a list that starts over. */
    key?: string;
  } = $props();

  const kept = untrack(() => keep(key, { load, version }));
  const pager = kept.pager as ReturnType<typeof createCatalogPages<T>>;
  const returning = kept.pager.snapshot().data.length > 0;
  $effect.pre(() => { kept.source = { load, version }; });
  let view = $state.raw(pager.snapshot());
  let active = $state(false);

  onMount(() => {
    const stop = pager.subscribe(() => { view = pager.snapshot(); });
    pager.connect();
    active = true;
    // what was kept shows at once; read it again behind it, in place
    if (returning) void pager.refresh();
    return () => { stop(); pager.disconnect(); };
  });

  $effect(() => {
    version;
    if (active) untrack(() => pager.activate(true));
  });
</script>

{#if view.data.length}
  {@render items(view.data)}
  <LoadMore cursor={view.cursor} loading={view.loading} error={view.error} {label} load={pager.more} retry={pager.retry} />
{:else if view.error}
  <p class="state" role="alert">{view.error}</p>
  <button type="button" class="text-button" onclick={pager.retry}>retry {label}</button>
{:else if view.loading}
  <Loading label={`loading ${label}`} inline />
{:else}
  <p class="state">{empty}</p>
{/if}
