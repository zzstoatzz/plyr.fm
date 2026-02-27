<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { jam } from '$lib/jam.svelte';
	import { toast } from '$lib/toast.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let error = $state<string | null>(null);

	onMount(async () => {
		const result = await jam.join(data.code);
		if (result === true) {
			// SvelteKit navigation preserves runtime — jam state survives
			goto('/');
		} else {
			error = result;
			toast.error(result);
		}
	});
</script>

<svelte:head>
	<title>joining jam - {APP_NAME}</title>
	{#if data.preview}
		{@const preview = data.preview}
		{@const title = preview.name ?? `${preview.host_display_name}'s jam`}
		{@const description =
			preview.participant_count > 1
				? `join ${preview.host_display_name} and ${preview.participant_count - 1} others on plyr.fm`
				: `join ${preview.host_display_name} on plyr.fm`}
		<meta property="og:title" content={title} />
		<meta property="og:description" content={description} />
		{#if preview.host_avatar_url}
			<meta property="og:image" content={preview.host_avatar_url} />
		{/if}
		<meta property="og:url" content={`${APP_CANONICAL_URL}/jam/${preview.code}`} />
	{/if}
</svelte:head>

<div class="join-page">
	{#if error}
		<div class="error-state">
			<p>{error}</p>
			<a href="/">go home</a>
		</div>
	{:else}
		<p class="joining">joining jam...</p>
	{/if}
</div>

<style>
	.join-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
	}

	.joining {
		color: var(--text-tertiary);
		font-size: var(--text-base);
	}

	.error-state {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		color: var(--text-secondary);
	}

	.error-state a {
		color: var(--accent);
		text-decoration: none;
	}

	.error-state a:hover {
		text-decoration: underline;
	}
</style>
