<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';

	let error = $state<string | null>(null);

	onMount(async () => {
		// the authorization server returns params in the fragment
		const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
		history.replaceState(null, '', location.pathname);
		try {
			await auth.finish(params);
			goto('/', { replaceState: true });
		} catch (e) {
			error = (e as Error).message;
		}
	});
</script>

{#if error}
	<h1>sign in failed</h1>
	<p class="error">{error}</p>
	<a href="/login">try again</a>
{:else}
	<p class="muted">signing you in…</p>
{/if}
