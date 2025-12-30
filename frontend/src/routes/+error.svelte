<script lang="ts">
	import { page } from '$app/stores';
	import { APP_NAME } from '$lib/branding';

	const status = $page.status;
	const message = $page.error?.message || 'something went wrong';
</script>

<svelte:head>
	<title>{status} - {APP_NAME}</title>
</svelte:head>

<div class="error-container">
	{#if status === 404}
		<div class="bufo-container">
			<img
				src="https://all-the.bufo.zone/bufo-shrug.png"
				alt="bufo shrug"
				class="bufo-img"
			/>
		</div>
		<h1>404</h1>
		<p class="error-message">we couldn't find what you're looking for</p>
	{:else if status === 500}
		<h1>500</h1>
		<p class="error-message">something went wrong on our end</p>
		<p class="error-detail">we've been notified and will look into it</p>
	{:else}
		<h1>{status}</h1>
		<p class="error-message">{message}</p>
	{/if}

	<a href="/" class="home-link">go home</a>
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

	.home-link {
		color: var(--accent);
		text-decoration: none;
		font-size: 1.1rem;
		padding: 0.75rem 1.5rem;
		border: 1px solid var(--accent);
		border-radius: var(--radius-base);
		transition: all 0.2s;
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
	}
</style>
