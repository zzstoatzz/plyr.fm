<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { APP_NAME } from '$lib/branding';

	const status = $page.status;
	const handle = $page.params.handle;

	let checkingBluesky = $state(false);
	let blueskyProfileExists = $state(false);
	let blueskyUrl = $state('');

	onMount(async () => {
		// if this is a 404, check if the handle exists on Bluesky
		if (status === 404 && handle) {
			checkingBluesky = true;
			try {
				// try to resolve the handle via ATProto
				const response = await fetch(
					`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`
				);

				if (response.ok) {
					const data = await response.json();
					if (data.did) {
						blueskyProfileExists = true;
						blueskyUrl = `https://bsky.app/profile/${handle}`;
					}
				}
			} catch (e) {
				console.error('failed to check Bluesky:', e);
			} finally {
				checkingBluesky = false;
			}
		}
	});
</script>

<svelte:head>
	<title>404 - artist not found - {APP_NAME}</title>
</svelte:head>

<div class="error-container">
	<div class="bufo-container">
		<img
			src="https://all-the.bufo.zone/bufo-shrug.png"
			alt="bufo shrug"
			class="bufo-img"
		/>
	</div>

	<h1>404</h1>

	{#if checkingBluesky}
		<p class="error-message">checking if @{handle} exists...</p>
	{:else if blueskyProfileExists}
		<p class="error-message">@{handle} hasn't joined {APP_NAME} yet</p>
		<p class="error-detail">but they're on Bluesky!</p>
		<div class="actions">
			<a href={blueskyUrl} target="_blank" rel="noopener" class="bsky-link">
				view their Bluesky profile
			</a>
			<a href="/" class="home-link">go home</a>
		</div>
	{:else}
		<p class="error-message">we couldn't find anyone by @{handle}</p>
		<p class="error-detail">the handle might not exist or could be misspelled</p>
		<a href="/" class="home-link">go home</a>
	{/if}
</div>

<style>
	.error-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem;
		text-align: center;
	}

	.bufo-container {
		margin-bottom: 2rem;
	}

	.bufo-img {
		width: 200px;
		height: auto;
		opacity: 0.9;
	}

	h1 {
		font-size: 4rem;
		color: var(--text-primary);
		margin: 0 0 1rem 0;
		font-weight: 700;
	}

	.error-message {
		font-size: 1.25rem;
		color: var(--text-secondary);
		margin: 0 0 0.5rem 0;
	}

	.error-detail {
		font-size: 1rem;
		color: var(--text-tertiary);
		margin: 0 0 2rem 0;
	}

	.actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.home-link,
	.bsky-link {
		color: var(--accent);
		text-decoration: none;
		font-size: 1.1rem;
		padding: 0.75rem 1.5rem;
		border: 1px solid var(--accent);
		border-radius: 6px;
		transition: all 0.2s;
		display: inline-block;
	}

	.bsky-link {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.bsky-link:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.home-link:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	@media (max-width: 768px) {
		.bufo-img {
			width: 150px;
		}

		h1 {
			font-size: 3rem;
		}

		.error-message {
			font-size: 1.1rem;
		}

		.actions {
			flex-direction: column;
			width: 100%;
			max-width: 300px;
		}
	}
</style>
