<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth, logout } from '$lib/auth';
	import Icon from '$lib/ui/Icon.svelte';
	import { activeUploadCount } from '$lib/upload-activity.svelte';

	let account = $state.raw(auth.getAuth());
	const uploading = $derived(activeUploadCount(account.did));
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

	async function signOut() {
		void logout();
		await goto('/');
	}
</script>

<svelte:head><title>settings · plyr.fm</title></svelte:head>

<section class="page-content settings">
	<h1>settings</h1>
	{#if account.did}
		<section aria-label="Account">
			<div class="card">
				<div class="row"><Icon name="user" size={21} /><span>{account.handle ? '@' + account.handle : account.did}</span></div>
				<a class="row" href="/portal"><Icon name="portal" size={21} />your music</a>
				<a class="row" href="/upload"><Icon name="upload" size={21} />{uploading === 0 ? 'upload' : uploading === 1 ? '1 upload in progress' : `${uploading} uploads in progress`}</a>
				<a class="row" href="/private"><Icon name="music" size={21} />private music</a>
				<button class="row" type="button" onclick={signOut}><Icon name="logout" size={21} />sign out</button>
			</div>
		</section>
	{:else if account.ready}
		<p class="state"><a href="/login?return_to=%2Fsettings">sign in</a> to see your account.</p>
	{/if}
	<a class="text-button" href={resolve('/(app)/stats')}>stats</a>
</section>

<style>
	.settings { max-width: 44rem; }
	.settings > section { margin-block: 1.35rem; }
	.card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.85rem; padding: 0.25rem 0.8rem; }
	.row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem 0.8rem; min-height: 3rem; padding: 0.6rem 0.2rem; overflow-wrap: anywhere; }
	.row > :global(svg) { flex: none; color: var(--muted); }
	.row:not(:first-child) { border-top: 1px solid var(--line); }
	button.row { border: 0; border-radius: 0; background: none; width: 100%; text-align: start; }
	button.row:hover { text-decoration: underline; text-underline-offset: 0.2em; }
</style>
