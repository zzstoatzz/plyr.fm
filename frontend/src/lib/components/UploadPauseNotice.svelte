<script lang="ts">
	let { message }: { message: string } = $props();
</script>

<section aria-labelledby="upload-pause-title">
	<h3 id="upload-pause-title">uploads temporarily paused</h3>
	<p>{message}</p>
	<a href="https://bsky.app/profile/zzstoatzz.io" target="_blank" rel="noopener noreferrer">
		contact nate on bluesky
	</a>
</section>

<style>
	section {
		padding: 1.5rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-tertiary);
	}
	h3 {
		margin: 0 0 0.75rem;
		font-size: var(--text-lg);
		color: var(--text-primary);
	}
	p {
		margin: 0 0 1rem;
		font-size: var(--text-base);
		line-height: 1.6;
		color: var(--text-secondary);
	}
	a {
		color: var(--accent);
		font-size: var(--text-sm);
	}
</style>
