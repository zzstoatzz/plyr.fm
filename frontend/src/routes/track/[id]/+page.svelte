<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';

	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	onMount(() => {
		// redirect to home page with track query param for playback
		const trackId = $page.params.id;
		goto(`/?track=${trackId}`, { replaceState: true });
	});
</script>

<svelte:head>
	<title>{data.track.title} - {data.track.artist}{data.track.album ? ` • ${data.track.album}` : ''}</title>
	<meta
		name="description"
		content="{data.track.title} by {data.track.artist}{data.track.album ? ` from ${data.track.album}` : ''} - listen on {APP_NAME}"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.song" />
	<meta property="og:title" content="{data.track.title} - {data.track.artist}" />
	<meta
		property="og:description"
		content="{data.track.artist}{data.track.album ? ` • ${data.track.album}` : ''}"
	/>
	<meta
		property="og:url"
		content={`${APP_CANONICAL_URL}/track/${data.track.id}`}
	/>
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{data.track.artist_handle}" />
	{#if data.track.album}
		<meta property="music:album" content="{data.track.album}" />
	{/if}
	{#if data.track.image_url}
		<meta property="og:image" content="{data.track.image_url}" />
		<meta property="og:image:secure_url" content="{data.track.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{data.track.title} by {data.track.artist}" />
	{/if}
	{#if data.track.r2_url}
		<meta property="og:audio" content="{data.track.r2_url}" />
		<meta property="og:audio:type" content="audio/{data.track.file_type}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{data.track.title}" />
	<meta
		name="twitter:description"
		content="{data.track.artist}{data.track.album ? ` • ${data.track.album}` : ''}"
	/>
	{#if data.track.image_url}
		<meta name="twitter:image" content="{data.track.image_url}" />
	{/if}
</svelte:head>

<!-- Page redirects on mount, but keep meta tags for link preview crawlers -->
<div class="loading">redirecting...</div>

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: #888;
	}
</style>
