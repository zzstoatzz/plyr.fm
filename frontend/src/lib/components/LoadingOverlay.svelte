<script lang="ts">
	import LoadingSpinner from './LoadingSpinner.svelte';

	interface Props {
		message?: string;
	}

	let { message = 'loading...' }: Props = $props();
</script>

<div class="overlay">
	<div class="content">
		<LoadingSpinner size="lg" />
		<p>{message}</p>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(10, 10, 10, 0.8);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}

	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
	}

	p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
</style>
