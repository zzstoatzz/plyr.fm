<script lang="ts" module>
	export interface Person { did: string; handle?: string; name?: string; avatar?: string }
</script>

<script lang="ts">
	import { memberDid } from '@plyr/next-core/access/policy-read';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';

	// pick people by searching for them: each one becomes a removable chip, never a typed list
	let { people = $bindable([]), owner, disabled = false }: { people?: Person[]; owner?: string; disabled?: boolean } = $props();

	let query = $state('');
	let results = $state.raw<Person[]>([]);
	let active = $state(0);
	let focused = $state(false);
	let error = $state('');
	let resolving = $state(false);
	let input: HTMLInputElement;
	const id = $props.id();
	const picked = $derived(new Set(people.map(person => person.did)));
	const shown = $derived(results.filter(person => !picked.has(person.did) && person.did !== owner));
	const open = $derived(focused && shown.length > 0 && !disabled);

	$effect(() => {
		const text = query.trim().replace(/^@/, '');
		results = [];
		active = 0;
		if (text.length < 2 || text.startsWith('did:')) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			const endpoint = new URL('https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead');
			endpoint.search = new URLSearchParams({ q: text, limit: '6' }).toString();
			void fetch(endpoint, { signal: controller.signal, headers: { 'X-Client': 'next.plyr.fm' } })
				.then(async response => {
					if (!response.ok || controller.signal.aborted) return;
					const found: { actors?: { did: string; handle: string; displayName?: string; avatar?: string }[] } = await response.json();
					if (!controller.signal.aborted) results = (found.actors ?? []).map(actor => ({ did: actor.did, handle: actor.handle, name: actor.displayName?.trim() || undefined, avatar: actor.avatar }));
				}).catch(() => {});
		}, 150);
		return () => { clearTimeout(timer); controller.abort(); };
	});

	function add(person: Person) {
		if (!picked.has(person.did) && person.did !== owner) people = [...people, person];
		query = '';
		error = '';
		input.focus();
	}
	/** enter with no match: take the text as a handle or DID */
	async function addTyped() {
		const text = query.trim();
		if (!text || resolving) return;
		resolving = true;
		try {
			const did = await memberDid(text);
			if (did === owner) error = 'you can always listen to your own tracks.';
			else add({ did, handle: text.replace(/^@/, '').startsWith('did:') ? undefined : text.replace(/^@/, '') });
		} catch (failure) { error = failure instanceof Error ? failure.message : 'could not find that account.'; }
		finally { resolving = false; }
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (open && shown[active]) add(shown[active]); else void addTyped();
		} else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			results = [];
		} else if (event.key === 'Backspace' && !query && people.length) {
			people = people.slice(0, -1);
		}
	}
	const label = (person: Person) => person.name ?? (person.handle ? `@${person.handle}` : 'someone');
</script>

<div class="people">
	{#if people.length}
		<ul class="chips" aria-label="People who can listen">
			{#each people as person (person.did)}
				<li class="chip">
					<span class="face"><Artwork src={person.avatar} size={28} /></span>
					<span class="truncate">{label(person)}</span>
					<button type="button" {disabled} aria-label={`Remove ${label(person)}`} onclick={() => { people = people.filter(other => other.did !== person.did); }}><Icon name="x" size={14} /></button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="field">
		<label class="search">
			<Icon name="search" size={18} />
			<input bind:this={input} bind:value={query} type="search" role="combobox" aria-label="Add a person" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-matches`}
				aria-activedescendant={open ? `${id}-match-${active}` : undefined} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
				placeholder="search for someone" autocomplete="off" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore data-bwignore {disabled}
				onfocus={() => { focused = true; }} onblur={() => { focused = false; }} oninput={() => { error = ''; }} onkeydown={keydown} />
			{#if resolving}<span class="spin" aria-hidden="true"></span>{/if}
		</label>
		<div role="listbox" id={`${id}-matches`} aria-label="Matching people" hidden={!open}>
			{#each shown as person, index (person.did)}
				<button role="option" type="button" tabindex="-1" id={`${id}-match-${index}`} aria-selected={active === index}
					onpointerdown={event => event.preventDefault()} onclick={() => add(person)}>
					<span class="face big"><Artwork src={person.avatar} size={40} eager /></span>
					<span class="who"><strong class="truncate">{person.name ?? `@${person.handle}`}</strong>{#if person.name && person.handle}<small class="truncate">@{person.handle}</small>{/if}</span>
					<Icon name="plus" size={18} />
				</button>
			{/each}
		</div>
	</div>
	{#if error}<p id={`${id}-error`} class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.people { display: grid; gap: 0.6rem; min-width: 0; }
	.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.chip { display: inline-flex; align-items: center; gap: 0.45rem; max-width: 100%; padding: 0.2rem 0.2rem 0.2rem 0.25rem; border-radius: 999px; background: var(--raised); font-weight: 600; font-size: var(--t-14); }
	.face { flex: none; width: 1.75rem; height: 1.75rem; border-radius: 50%; overflow: hidden; }
	.face.big { width: 2.5rem; height: 2.5rem; }
	.chip button { flex: none; display: grid; place-items: center; width: 2rem; height: 2rem; border: 0; border-radius: 50%; background: none; color: var(--muted); }
	.chip button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
	.field { position: relative; }
	.search { display: flex; align-items: center; gap: 0.55rem; min-height: 2.9rem; padding: 0 0.8rem; border: 1.5px solid var(--line); border-radius: 0.7rem; background: var(--raised); color: var(--muted); }
	.search:focus-within { border-color: var(--accent); }
	.search:has([aria-invalid='true']) { border-color: #ef4444; }
	input { flex: 1; min-width: 0; min-height: 2.75rem; border: 0; outline: 0; background: none; color: var(--text); font-size: max(16px, 1rem); }
	[role='listbox'] { z-index: 2; position: absolute; inset: calc(100% + 0.3rem) 0 auto; padding: 0.3rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--surface); box-shadow: 0 0.8rem 2rem rgb(0 0 0 / 0.18); }
	[role='option'] { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; width: 100%; min-height: 3.2rem; padding: 0 0.6rem; border: 0; border-radius: 0.5rem; background: none; color: var(--muted); text-align: start; }
	[role='option']:hover, [aria-selected='true'] { background: var(--hover); }
	.who { display: grid; gap: 0.1rem; min-width: 0; }
	.who strong { color: var(--text); }
	small { font-size: var(--t-12-8); }
	.error { margin: 0; color: #ef4444; font-size: var(--t-14); }
	.spin { width: 1rem; height: 1rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
