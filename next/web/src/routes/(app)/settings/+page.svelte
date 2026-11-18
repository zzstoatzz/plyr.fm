<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth, authorizeScrobbling, canScrobble, logout } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import { accents, prefs, scales, setPrefs, themes } from '$lib/prefs.svelte';
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
					<span><strong>teal.fm scrobbling</strong><small id="scrobble-detail">log your listens to public tracks on teal.fm</small></span>
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
	h2 { font-size: 1.125rem; margin-bottom: 0.55rem; }
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
