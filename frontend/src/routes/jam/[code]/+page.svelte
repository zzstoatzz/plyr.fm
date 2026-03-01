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
	{#if data.preview}
		{@const preview = data.preview}
		{@const title = preview.name ?? `${preview.host_display_name}'s jam`}
		{@const description =
			preview.participant_count > 1
				? `join ${preview.host_display_name} and ${preview.participant_count - 1} others on ${APP_NAME}`
				: `${preview.host_display_name} is listening on ${APP_NAME} — join in`}
		<title>{title} - {APP_NAME}</title>
		<meta name="description" content={description} />

		<!-- Open Graph -->
		<meta property="og:type" content="website" />
		<meta property="og:title" content={title} />
		<meta property="og:description" content={description} />
		<meta property="og:url" content={`${APP_CANONICAL_URL}/jam/${preview.code}`} />
		<meta property="og:site_name" content={APP_NAME} />
		{#if preview.host_avatar_url}
			<meta property="og:image" content={preview.host_avatar_url} />
			<meta property="og:image:secure_url" content={preview.host_avatar_url} />
			<meta property="og:image:width" content="400" />
			<meta property="og:image:height" content="400" />
			<meta property="og:image:alt" content="{preview.host_display_name}'s avatar" />
		{/if}

		<!-- Twitter -->
		<meta name="twitter:card" content="summary" />
		<meta name="twitter:title" content={title} />
		<meta name="twitter:description" content={description} />
		{#if preview.host_avatar_url}
			<meta name="twitter:image" content={preview.host_avatar_url} />
		{/if}
	{:else}
		<title>joining jam - {APP_NAME}</title>
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
