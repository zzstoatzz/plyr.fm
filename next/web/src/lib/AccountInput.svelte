<script lang="ts">
	import Artwork from './ui/Artwork.svelte';

	interface Actor { did: string; handle: string; displayName?: string; avatar?: string }
	let { value = $bindable(''), disabled, select }: {
		value?: string; disabled: boolean; select: (handle: string) => void;
	} = $props();
	let actors = $state.raw<Actor[]>([]);
	let active = $state(-1);
	let focused = $state(false);
	let dismissed = $state(false);
	const open = $derived(focused && !dismissed && actors.length > 0 && !disabled);

	$effect(() => {
		const input = value.trim().replace(/^@/, '');
		active = -1;
		actors = [];
		if (disabled || input.length < 2 || input.startsWith('did:')) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			const endpoint = new URL('https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead');
			endpoint.search = new URLSearchParams({ q: input, limit: '5' }).toString();
			void fetch(endpoint, { signal: controller.signal, headers: { 'X-Client': 'next.plyr.fm' } })
				.then(async response => {
					if (!response.ok || controller.signal.aborted) return;
					const result: { actors?: Actor[] } = await response.json();
					if (!controller.signal.aborted) actors = result.actors ?? [];
				}).catch(() => {});
		}, 150);
		return () => { clearTimeout(timer); controller.abort(); };
	});

	function choose(handle: string) {
		value = handle;
		dismissed = true;
		select(handle);
	}

	function keydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			dismissed = true;
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			active = event.key === 'ArrowDown'
				? (active + 1) % actors.length
				: active < 0 ? actors.length - 1 : (active + actors.length - 1) % actors.length;
		} else if (event.key === 'Enter' && actors[active]) {
			event.preventDefault();
			choose(actors[active].handle);
		}
	}
</script>

<div class="picker">
	<input id="account-handle" type="search" role="combobox" aria-autocomplete="list" aria-expanded={open}
		aria-controls="account-matches" aria-activedescendant={open && active >= 0 ? 'account-match-' + active : undefined}
		bind:value {disabled} autocomplete="off" autocapitalize="none" spellcheck="false"
		data-1p-ignore data-lpignore data-bwignore placeholder="you.bsky.social"
		onfocus={() => { focused = true; dismissed = false; }}
		onblur={() => { focused = false; }}
		oninput={() => { dismissed = false; }} onkeydown={keydown} />
	<div role="listbox" id="account-matches" aria-label="matching accounts" hidden={!open}>
		{#each actors as actor, index (actor.did)}
			<button role="option" type="button" tabindex="-1" id={'account-match-' + index} aria-selected={active === index}
				onpointerdown={event => event.preventDefault()} onclick={() => choose(actor.handle)}>
				<span class="avatar"><Artwork src={actor.avatar} size={32} eager /></span>
				<span class="result"><strong class="truncate">@{actor.handle}</strong>
					{#if actor.displayName}<span class="subtle truncate">{actor.displayName}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.picker { position: relative; }
	input { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 0.55rem; padding: 0.72rem; min-height: 2.75rem; }
	[role='listbox'] { z-index: 1; position: absolute; inset: calc(100% + 0.25rem) 0 auto; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); box-shadow: 0 0.4rem 1.5rem rgb(0 0 0 / 0.12); overflow: hidden; }
	[role='option'] { text-align: start; display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 2.75rem; border: 0; padding: 0.55rem 0.65rem; background: transparent; }
	[role='option']:hover, [aria-selected='true'] { background: var(--hover); }
	.avatar { border-radius: 50%; flex: 0 0 2rem; }
	.result { display: grid; min-width: 0; }
</style>
