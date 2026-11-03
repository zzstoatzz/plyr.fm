<script lang="ts">
	import Loading from '$lib/ui/Loading.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';

	let error = $state<string | null>(null);
	let scopeRejected = $state(false);

	onMount(async () => {
		// the authorization server returns params in the fragment
		const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
		history.replaceState(null, '', location.pathname);
		try {
			await auth.finish(params);
			goto('/', { replaceState: true });
		} catch (e) {
			scopeRejected = params.get('error') === 'invalid_scope';
			error = (e as Error).message;
		}
	});
</script>

{#if error}
	<h1>sign in failed</h1>
	<p class="error">{error}</p>
	{#if scopeRejected}
		<a href="/login?device-only">sign in without preference sync</a>
	{:else}
		<a href="/login">try again</a>
	{/if}
{:else}
	<Loading label="signing you in" />
{/if}
