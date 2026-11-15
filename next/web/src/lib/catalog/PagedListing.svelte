<script lang="ts" generics="T">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Page } from '$core/api';
  import { createCatalogPages } from '$core/catalog/pages';
  import Loading from '$lib/ui/Loading.svelte';

  let { load, items, empty, more, label, version = 0 }: {
    load: (cursor?: string) => Promise<Page<T>>;
    items: Snippet<[T[]]>;
    empty: string;
    more?: string;
    label: string;
    version?: number;
  } = $props();

  const pager = createCatalogPages(cursor => load(cursor), () => version);
  let view = $state.raw(pager.snapshot());
  let active = $state(false);

  onMount(() => {
    const stop = pager.subscribe(() => { view = pager.snapshot(); });
    pager.connect();
    active = true;
    return () => { stop(); pager.disconnect(); };
  });

  $effect(() => {
    version;
    if (active) untrack(() => pager.activate(true));
  });
</script>

{#if view.data.length}{@render items(view.data)}{/if}
{#if view.error}
  <p class="state" role="alert">{view.error}</p>
  <button type="button" class="text-button" onclick={pager.retry}>retry {label}</button>
{:else if view.loading}
  <Loading label={`loading ${label}`} inline />
{:else if !view.data.length}
  <p class="state">{empty}</p>
{/if}
{#if more && view.cursor && !view.loading && !view.error}
  <button type="button" class="text-button" onclick={pager.more}>{more}</button>
{/if}
