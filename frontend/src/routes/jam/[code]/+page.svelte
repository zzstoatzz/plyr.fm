<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { jam } from '$lib/jam.svelte';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';
	import { setReturnUrl } from '$lib/utils/return-url';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let error = $state<string | null>(null);

	onMount(async () => {
		// wait for auth check to complete (runs in layout)
		while (auth.loading) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			// don't try to join — show preview UI instead
			return;
		}

		// authenticated — proceed with join
		const result = await jam.join(data.code);
		if (result === true) {
			goto('/');
		} else {
			error = result;
			toast.error(result);
		}
	});

	function handleSignIn() {
		setReturnUrl(`/jam/${data.code}`);
	}
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
	{#if auth.loading}
		<WaveLoading size="sm" message="loading..." />
	{:else if !auth.isAuthenticated}
		<div class="preview-card">
			{#if data.preview}
				{#if data.preview.host_avatar_url}
					<img src={data.preview.host_avatar_url} alt="" class="host-avatar" />
				{/if}
				<h2>{data.preview.name ?? `${data.preview.host_display_name}'s jam`}</h2>
				<p class="preview-description">
					{data.preview.participant_count > 1
						? `${data.preview.host_display_name} and ${data.preview.participant_count - 1} others are listening`
						: `${data.preview.host_display_name} is listening`}
				</p>
			{:else}
				<h2>join a jam</h2>
			{/if}
			<a href="/login?return_to=/jam/{data.code}" class="sign-in-button" onclick={handleSignIn}>
				sign in to join
			</a>
		</div>
	{:else if error}
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

	.preview-card {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		max-width: 360px;
		width: 100%;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 2rem;
	}

	.host-avatar {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
	}

	.preview-card h2 {
		font-size: var(--text-xl);
		color: var(--text-primary);
		margin: 0;
	}

	.preview-description {
		color: var(--text-secondary);
		font-size: var(--text-base);
		margin: 0;
	}

	.sign-in-button {
		display: inline-block;
		margin-top: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--accent);
		color: white;
		border-radius: var(--radius-md);
		text-decoration: none;
		font-weight: 500;
		font-size: var(--text-base);
		transition: opacity 0.15s;
	}

	.sign-in-button:hover {
		opacity: 0.9;
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
