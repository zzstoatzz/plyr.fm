<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { completeCallback } from '$lib/atproto/client';
	import { toast } from '$lib/toast.svelte';

	onMount(async () => {
		try {
			const returnTo = await completeCallback();
			await goto(returnTo ?? '/', { replaceState: true });
		} catch (e) {
			console.error('atproto callback failed:', e);
			toast.error('could not finish connecting to your account');
			await goto('/', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>signing you in — plyr.fm</title>
</svelte:head>

<main class="callback">
	<p>finishing sign-in…</p>
</main>

<style>
	.callback {
		display: flex;
		justify-content: center;
		padding: 4rem 1rem;
		color: var(--text-secondary);
	}
</style>
