<script lang="ts">
	import { API_URL } from '$lib/config';
	import type { RadioListeners } from '$lib/radio-presence';

	let { station }: { station: string } = $props();
	let presence = $state<RadioListeners | null>(null);
	$effect(() => {
		const slug = station;
		const controller = new AbortController();
		presence = null;
		async function refresh(): Promise<void> {
			try {
				const response = await fetch(`${API_URL}/radio/${encodeURIComponent(slug)}/listeners`, {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('presence unavailable');
				const value: RadioListeners = await response.json();
				if (!controller.signal.aborted) presence = value;
			} catch {
				if (!controller.signal.aborted) presence = null;
			}
		}
		void refresh();
		const timer = window.setInterval(refresh, 5000);
		return () => {
			controller.abort();
			window.clearInterval(timer);
		};
	});
</script>

<div class="listeners" aria-label="station listeners">
	{#if presence}
		<div class="avatars">
			{#each presence.listeners.slice(0, 8) as listener (listener.did)}
				<a
					href={`/u/${listener.handle}`}
					aria-label={`${listener.display_name} is listening`}
					title={`@${listener.handle}`}
				>
					{#if listener.avatar_url}
						<img src={listener.avatar_url} alt="" width="28" height="28" />
					{:else}
						<span aria-hidden="true">{listener.display_name.slice(0, 1)}</span>
					{/if}
				</a>
			{/each}
		</div>
		<span>{presence.count} listening</span>
	{:else}
		<span>listeners unavailable</span>
	{/if}
</div>

<style>
	.listeners {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.avatars {
		display: flex;
		padding-left: 0.35rem;
	}
	a {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: -0.35rem;
		border: 2px solid var(--bg-primary);
		border-radius: var(--radius-full);
		background: var(--bg-tertiary);
		color: var(--text-primary);
		text-decoration: none;
	}
	a:hover {
		outline: 2px solid var(--accent);
		z-index: 1;
	}
	img {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		object-fit: cover;
	}
</style>
