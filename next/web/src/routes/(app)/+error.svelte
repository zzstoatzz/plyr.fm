<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { profileApp, profileLink } from '$lib/profile-link';

	const missing = $derived(page.status === 404);
	const actor = $derived(missing ? page.params.actor : undefined);
	let elsewhere = $state<string>();

	// someone not on plyr.fm can still have a profile in the atmosphere: link to it when the handle resolves
	$effect(() => {
		elsewhere = undefined;
		const name = actor;
		if (!name) return;
		const controller = new AbortController();
		const known = name.startsWith('did:') ? Promise.resolve(true)
			: fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(name)}`, { signal: controller.signal }).then(response => response.ok);
		known.then(found => { if (found) elsewhere = name; }, () => undefined);
		return () => controller.abort();
	});
</script>

<svelte:head><title>{missing ? 'not found' : 'something went wrong'} · plyr.fm</title></svelte:head>

<div class="page-content error">
	{#if missing}<img src="https://all-the.bufo.zone/bufo-shrug.png" alt="" width="180" height="180" />{/if}
	<h1>{missing ? '404' : 'hmm'}</h1>
	<p class="subtle">{missing ? (page.error?.message ?? "we couldn't find what you're looking for") : (page.error?.message ?? "plyr.fm couldn't load this page.")}</p>
	<div class="links">
		{#if elsewhere}
			<a class="text-button" href={profileLink(elsewhere)} target="_blank" rel="noopener noreferrer">{elsewhere.startsWith('did:') ? 'see their profile' : `see @${elsewhere}`} on {profileApp()}</a>
		{/if}
		{#if missing}
			<a class="text-button" href={resolve('/search')}>search plyr.fm</a>
		{:else}
			<button class="text-button" type="button" onclick={() => location.reload()}>try again</button>
		{/if}
		<a class="text-button" href={resolve('/')}>go home</a>
	</div>
</div>

<style>
	.error { display: grid; align-content: center; justify-items: center; text-align: center; gap: 0.65rem; min-height: 70dvh; }
	img { object-fit: contain; }
	h1 { font-size: clamp(2.7rem, 8vw, 4rem); }
	.links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.25rem; }
	.links :is(a, button) { color: var(--accent); }
</style>
