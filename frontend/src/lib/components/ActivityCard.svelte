<script lang="ts">
	import type { ActivityEvent } from '$lib/types';

	interface Props {
		event: ActivityEvent;
	}

	let { event }: Props = $props();

	const name = $derived(event.actor.display_name || event.actor.handle.split('.')[0]);

	const artSrc = $derived(
		event.track?.thumbnail_url ?? event.track?.image_url ?? event.actor.avatar_url
	);

	const artLink = $derived(
		event.track ? `/track/${event.track.id}` : `/u/${event.actor.handle}`
	);

	function timeAgo(iso: string): string {
		const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	}
</script>

<div class="activity-card">
	<a href={artLink} class="card-art">
		{#if artSrc}
			<img src={artSrc} alt="" />
		{:else}
			<div class="art-placeholder">
				<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="8" cy="5" r="3" fill="none" />
					<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
				</svg>
			</div>
		{/if}
	</a>
	<div class="card-body">
		<div class="card-top">
			<a href="/u/{event.actor.handle}" class="actor">{name}</a>
			<span class="time" title={new Date(event.created_at).toLocaleString()}>
				{timeAgo(event.created_at)}
			</span>
		</div>
		<span class="verb {event.type}">
			{#if event.type === 'like'}
				<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
				liked
			{:else if event.type === 'track'}
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
				uploaded
			{:else if event.type === 'comment'}
				<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
				commented
			{:else if event.type === 'join'}
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
				joined
			{/if}
		</span>
		{#if event.track}
			<a href="/track/{event.track.id}" class="track-title">{event.track.title}</a>
		{/if}
	</div>
</div>

<style>
	.activity-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 200px;
		max-width: 200px;
		padding: 0.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		scroll-snap-align: start;
		transition: border-color 0.15s, background 0.15s;
	}

	.activity-card:hover {
		border-color: var(--border-default);
		background: var(--bg-hover);
	}

	.card-art {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-tertiary);
		display: block;
	}

	.card-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.art-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.card-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.25rem;
	}

	.actor {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-primary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
	}

	.actor:hover {
		color: var(--accent);
	}

	.time {
		font-size: var(--text-xs);
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.verb {
		font-size: var(--text-xs);
		display: inline-flex;
		align-items: center;
		gap: 0.2em;
	}

	.verb.like { color: #e0607e; }
	.verb.track { color: var(--accent); }
	.verb.comment { color: #a78bfa; }
	.verb.join { color: #4ade80; }

	.track-title {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
	}

	.track-title:hover {
		color: var(--accent);
	}
</style>
