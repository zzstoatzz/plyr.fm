<script lang="ts">
	import { API_URL } from '$lib/config';

	let { message }: { message: string } = $props();
	let feedback = $state('');
	let submitting = $state(false);
	let sent = $state(false);
	let error = $state('');

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting || !feedback.trim()) return;
		submitting = true;
		error = '';
		try {
			const response = await fetch(`${API_URL}/tracks/me/upload-feedback`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: feedback.trim() })
			});
			if (!response.ok) {
				error = response.status === 429
					? 'you’ve sent a few messages recently. please try again in an hour.'
					: 'your message couldn’t be saved. please try again.';
				return;
			}
			sent = true;
			feedback = '';
		} catch {
			error = 'your message couldn’t be saved. please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<section aria-labelledby="upload-pause-title">
	<h3 id="upload-pause-title">uploads temporarily paused</h3>
	<p>{message}</p>
	{#if sent}
		<p role="status">thanks. your message has been saved for nate.</p>
	{:else}
		<form onsubmit={submit}>
			<label for="upload-feedback">send nate a message here</label>
			<p id="upload-feedback-help" class="help">
				no bluesky account needed. this won’t be posted publicly. include a way to reach you if you’d like a reply.
			</p>
			<textarea id="upload-feedback" aria-describedby="upload-feedback-help" bind:value={feedback} maxlength="2000" rows="4" required disabled={submitting}></textarea>
			{#if error}<p role="alert">{error}</p>{/if}
			<button type="submit" disabled={submitting || !feedback.trim()}>{submitting ? 'sending…' : 'send message'}</button>
		</form>
	{/if}
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
	form {
		display: grid;
		gap: 0.75rem;
		margin: 0 0 1.5rem;
	}
	label {
		color: var(--text-primary);
		font-size: var(--text-base);
	}
	.help {
		margin: 0;
		font-size: var(--text-sm);
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 0.75rem;
		resize: vertical;
		font: inherit;
		color: var(--text-primary);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
	}
	button {
		justify-self: start;
		padding: 0.5rem 1rem;
		font: inherit;
		color: var(--text-primary);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
