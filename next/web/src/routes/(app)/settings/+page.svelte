<script lang="ts">
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth, authorizeScrobbling, canScrobble, logout } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import { DEFAULT_HIDDEN_TAGS, hiddenTags } from '@plyr/next-core/hidden-tags';
	import { AT_CLIENTS } from '@plyr/next-core/at-clients';
	import { accents, fonts, prefs, scales, setPrefs, themes } from '$lib/prefs.svelte';
	import { comments } from '$lib/listening/comments';
	import Icon from '$lib/ui/Icon.svelte';

	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	let authorizing = $state(false);
	let scrobbleError = $state(false);
	const granted = $derived(account.did && canScrobble());

	async function toggleScrobbling(input: HTMLInputElement) {
		if (!input.checked) { setPrefs({ tealScrobbling: false }); return; }
		scrobbleError = false;
		authorizing = true;
		try { await authorizeScrobbling(); }
		catch { scrobbleError = true; input.checked = false; }
		finally { authorizing = false; }
	}

	// with no saved choice, phones use the system face and wider screens comic sans (app.css)
	const wide = new MediaQuery('min-width: 721px');
	const defaultFont = $derived(wide.current ? 'comic-sans' : 'system');
	const custom = $derived(!accents.some(accent => accent.color === prefs.accent));
	let tagDraft = $state<string>();
	let tagError = $state('');
	const tagValue = $derived(tagDraft ?? prefs.hiddenTags.join(', '));

	function saveTags(tags: string[] | undefined) {
		if (!tags) { tagError = 'use up to 10 tags, each under 200 characters.'; return; }
		setPrefs({ hiddenTags: tags });
		tagDraft = undefined;
		tagError = '';
	}

	async function signOut() {
		void logout();
		await goto(resolve('/'));
	}
</script>

<svelte:head><title>settings · plyr.fm</title></svelte:head>

<div class="page-content settings">
	<h1>settings</h1>

	<section aria-labelledby="appearance">
		<h2 id="appearance">appearance</h2>
		<div class="card">
			<fieldset>
				<legend>theme</legend>
				<div class="options">
					{#each themes as theme (theme)}
						<label class="option">
							<input type="radio" name="theme" value={theme} checked={prefs.theme === theme} onchange={() => setPrefs({ theme })} />
							<span>{theme}</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset>
				<legend>accent color</legend>
				<div class="options">
					{#each accents as accent (accent.color)}
						<label class="option swatch" data-accent={accent.color}>
							<input type="radio" name="accent" value={accent.color} aria-label={accent.name} checked={prefs.accent === accent.color} onchange={() => setPrefs({ accent: accent.color })} />
							<span aria-hidden="true"><i></i></span>
						</label>
					{/each}
					<label class="option swatch custom" class:selected={custom} title="custom accent">
						<input type="color" aria-label={custom ? `custom accent, ${prefs.accent}, selected` : 'custom accent'} value={prefs.accent} onchange={event => setPrefs({ accent: event.currentTarget.value.toLowerCase() })} />
						<span aria-hidden="true"><i style:background={custom ? prefs.accent : undefined}></i></span>
					</label>
				</div>
			</fieldset>
			<fieldset>
				<legend>font</legend>
				<div class="options">
					{#each fonts as font (font.value)}
						<label class="option">
							<input type="radio" name="font" value={font.value} checked={(prefs.font ?? defaultFont) === font.value} onchange={() => setPrefs({ font: font.value })} />
							<span data-font={font.value}>{font.name}</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset>
				<legend>text size</legend>
				<div class="options">
					{#each scales as scale (scale.value)}
						<label class="option">
							<input type="radio" name="scale" value={scale.value} checked={prefs.scale === scale.value} onchange={() => setPrefs({ scale: scale.value })} />
							<span>{scale.name}</span>
						</label>
					{/each}
				</div>
			</fieldset>
		</div>
	</section>

	<section aria-labelledby="playback">
		<h2 id="playback">playback</h2>
		<div class="card">
			<label class="toggle">
				<span><strong>play through collections</strong><small id="collection-detail">when you play a track in a list, keep playing the rest of the list</small></span>
				<input type="checkbox" role="switch" aria-label="play through collections" aria-describedby="collection-detail" checked={prefs.playThrough} onchange={event => setPrefs({ playThrough: event.currentTarget.checked })} />
			</label>
			<label class="toggle">
				<span><strong>keep playing</strong><small id="continuation-detail">play more tracks when your queue ends</small></span>
				<input type="checkbox" role="switch" aria-label="keep playing" aria-describedby="continuation-detail" checked={player.continuesPlaying} onchange={event => player.setKeepPlaying(event.currentTarget.checked)} />
			</label>
		</div>
	</section>

	<section aria-labelledby="discovery">
		<h2 id="discovery">discovery</h2>
		<div class="card tags">
			<label for="hidden-tags"><strong>hidden tags</strong><small id="hidden-detail">keep these tags out of latest tracks. artist pages and search still show them. hiding ai also hides accounts labeled for AI-generated audio.</small></label>
			<input id="hidden-tags" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="none" aria-describedby="hidden-detail{tagError ? ' hidden-error' : ''}" aria-invalid={!!tagError}
				value={tagValue} oninput={event => { tagDraft = event.currentTarget.value; tagError = ''; }}
				onkeydown={event => { if (event.key === 'Enter') saveTags(hiddenTags(tagValue.split(',').filter(tag => tag.trim()))); }} />
			{#if tagError}<p id="hidden-error" class="tag-error" role="alert">{tagError}</p>{/if}
			<div class="tag-actions">
				<button class="text-button save" type="button" disabled={tagDraft === undefined} onclick={() => saveTags(hiddenTags(tagValue.split(',').filter(tag => tag.trim())))}>save</button>
				<button class="text-button" type="button" onclick={() => saveTags([])}>show all tags</button>
				<button class="text-button" type="button" onclick={() => saveTags([...DEFAULT_HIDDEN_TAGS])}>restore defaults</button>
			</div>
		</div>
	</section>

	<section aria-labelledby="links">
		<h2 id="links">links</h2>
		<div class="card">
			<fieldset class="described" aria-describedby="links-detail">
				<legend>open profiles in</legend>
				<p id="links-detail" class="detail">the app you go to from an @handle on plyr.fm</p>
				<div class="options">
					{#each AT_CLIENTS as client (client.value)}
						<label class="option">
							<input type="radio" name="atproto-client" value={client.value} checked={prefs.atprotoClient === client.value} onchange={() => setPrefs({ atprotoClient: client.value })} />
							<span class="app"><img src={client.iconUrl} alt="" width="18" height="18" loading="lazy" onerror={event => event.currentTarget.remove()} />{client.label}</span>
						</label>
					{/each}
				</div>
			</fieldset>
		</div>
	</section>

	{#if account.did}
		<section aria-labelledby="your-tracks">
			<h2 id="your-tracks">your tracks</h2>
			<div class="card">
				<label class="toggle">
					<span><strong>timed comments</strong><small id="comments-detail">{account.accountSync ? 'let listeners leave comments on your tracks' : 'sign in again to change this for your tracks'}</small></span>
					<input type="checkbox" role="switch" aria-label="timed comments" aria-describedby="comments-detail" checked={prefs.allowComments} disabled={!account.accountSync} onchange={event => { setPrefs({ allowComments: event.currentTarget.checked }); comments.refresh(); }} />
				</label>
			</div>
		</section>
		<section aria-labelledby="integrations">
			<h2 id="integrations">integrations</h2>
			<div class="card">
				<label class="toggle">
					<span><strong>teal.fm scrobbling</strong><small id="scrobble-detail">log listens and show what you’re playing on teal.fm. public tracks only.</small></span>
					<input type="checkbox" role="switch" aria-label="teal.fm scrobbling" aria-describedby="scrobble-detail" checked={prefs.tealScrobbling && !!granted} disabled={authorizing} onchange={event => toggleScrobbling(event.currentTarget)} />
				</label>
				{#if authorizing}<p class="integration-status" role="status">opening sign-in…</p>
				{:else if scrobbleError || page.url.searchParams.has('teal')}<p class="integration-status" role="status">couldn’t connect teal.fm. try again.</p>
				{:else if prefs.tealScrobbling && !granted}<p class="integration-status" role="status">sign in again to reconnect teal.fm on this device.</p>{/if}
			</div>
		</section>
		<section aria-labelledby="account">
			<h2 id="account">account</h2>
			<div class="card account">
				<span class="truncate">{account.handle ? '@' + account.handle : account.did}</span>
				<button class="text-button" type="button" onclick={signOut}><Icon name="logout" size={19} />sign out</button>
			</div>
		</section>
	{/if}
</div>

<style>
	.settings { max-width: 44rem; display: grid; gap: 1.4rem; }
	h2 { font-size: var(--t-18); margin-bottom: 0.55rem; }
	.card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.85rem; padding-inline: 1rem; }
	fieldset { display: flex; align-items: center; position: relative; min-inline-size: 0; border: 0; margin: 0; padding: 2.25rem 0 0.75rem; }
	fieldset + fieldset, .toggle + .toggle { border-top: 1px solid var(--line); }
	legend { position: absolute; inset-block-start: 0.75rem; padding: 0; font-weight: 600; }
	.options { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.option { position: relative; cursor: pointer; }
	.option input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
	.option > span { display: grid; place-items: center; min-height: 2.75rem; min-width: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--line); border-radius: 0.55rem; color: var(--muted); background: var(--raised); }
	.option input:checked + span { border-color: var(--accent); color: var(--text); font-weight: 620; }
	.option input:focus-visible + span, .toggle input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	fieldset.described { display: grid; gap: 0.6rem; }
	.detail { margin: 0; color: var(--muted); }
	.option > .app { display: flex; gap: 0.45rem; }
	.app img { flex: none; border-radius: 0.25rem; object-fit: contain; }
	.custom input { opacity: 0; }
	.custom > span { background: conic-gradient(#f894b8, #c2a2ff, #6a9fff, #66cd9d, #f2c66d, #f894b8); }
	.custom.selected > span { border-color: var(--accent); }
	.swatch.custom i { background: var(--raised); }
	.swatch.custom.selected i { border: 2px solid var(--raised); }
	[data-font='comic-sans'] { font-family: 'Plyr Comic', system-ui, sans-serif; }
	[data-font='system'] { font-family: system-ui, -apple-system, sans-serif; }
	[data-font='mono'] { font-family: ui-monospace, Menlo, Consolas, monospace; }
	[data-font='serif'] { font-family: Georgia, 'Times New Roman', serif; }
	.tags { display: grid; gap: 0.6rem; padding-block: 0.85rem; }
	.tags label { display: grid; gap: 0.15rem; }
	.tags small { color: var(--muted); }
	.tags input[type='text'] { min-height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--line); border-radius: 0.55rem; background: var(--raised); }
	.tags input[type='text']:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	.tags input[aria-invalid='true'] { border-color: #ef4444; }
	.tag-error { margin: 0; color: #ef4444; }
	.tag-actions .save { color: var(--accent); font-weight: 620; }
	.tag-actions { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
	.swatch i { width: 1.1rem; height: 1.1rem; background: var(--palette-accent); border-radius: 50%; }
	.toggle, .account { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; min-height: 3.5rem; padding-block: 0.65rem; }
	.toggle { cursor: pointer; }
	.toggle strong { display: block; font-weight: 600; }
	.toggle small, .account > span { color: var(--muted); }
	.toggle input { appearance: none; box-sizing: content-box; flex: none; width: 2.1rem; height: 1.2rem; border: 1px solid var(--faint); border-radius: 2rem; margin: 0; padding: 0.15rem; background: var(--raised); cursor: pointer; }
	.toggle input::before { content: ''; display: block; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: var(--muted); }
	.toggle input:checked { background: var(--accent); border-color: var(--accent); }
	.toggle input:checked::before { transform: translateX(0.9rem); background: var(--on-accent); }
	.integration-status { padding-block-end: 0.8rem; color: var(--muted); }
	.account button { flex: none; }
</style>
