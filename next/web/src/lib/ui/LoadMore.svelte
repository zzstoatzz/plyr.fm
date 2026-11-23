<!--
  The end of every paged list: it loads the next page as it comes within 200px of view, the way home's
  latest tracks do, so no list asks for a "more" press. It holds one line of height whether idle, loading
  or failed, so the rows above never move when a page starts or lands. Inside a scrolling panel (a sheet,
  a popover) it watches that panel rather than the window.
-->
<script lang="ts">
	import Loading from './Loading.svelte';

	let { cursor, loading = false, error = '', label, load, retry = load }: {
		/** Whether there is a next page: its cursor, or true. */
		cursor: string | boolean | null | undefined;
		loading?: boolean;
		error?: string | null;
		/** What the list holds, as in "loading more {label}". */
		label: string;
		load: (button?: HTMLButtonElement) => unknown;
		retry?: (button?: HTMLButtonElement) => unknown;
	} = $props();

	const observed = typeof IntersectionObserver !== 'undefined';

	function scroller(node: HTMLElement) {
		for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
			if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
		}
		return null;
	}

	// Watching again whenever a load settles fires straight away if the end is still in view, so a short
	// page keeps filling the screen without waiting for another scroll.
	function watch(node: HTMLElement, ready: boolean) {
		if (!observed || !ready) return;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) load();
		}, { root: scroller(node), rootMargin: '0px 0px 200px' });
		observer.observe(node);
		return () => observer.disconnect();
	}
</script>

{#if cursor || error}
	<div class="more" data-testid="load-more" {@attach node => watch(node, !!cursor && !loading && !error)}>
		{#if error}
			<p role="status">{loading ? `loading more ${label}…` : error}</p>
			<button type="button" class="text-button" aria-disabled={loading} onclick={event => { if (!loading) retry(event.currentTarget); }}>try again</button>
		{:else if loading}<Loading label={`loading more ${label}`} inline />
		{:else if !observed}
			<button type="button" class="text-button" onclick={event => load(event.currentTarget)}>load more</button>
		{/if}
	</div>
{/if}

<style>
	.more { min-height: 2.75rem; color: var(--muted); }
</style>
