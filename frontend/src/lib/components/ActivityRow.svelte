<script lang="ts">
	import { timeAgo } from '$lib/activity-feed.svelte';
	import type { ActivityEvent } from '$lib/types';

	let { event }: { event: ActivityEvent } = $props();
</script>

<div class="activity-row {event.type}">
	<span class="activity-icon">
		{#if event.type === 'like'}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
		{:else if event.type === 'comment'}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
		{:else if event.type === 'join'}
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
		{/if}
	</span>
	<span class="activity-text">
		<a href="/u/{event.actor.handle}" class="activity-actor">{event.actor.display_name || event.actor.handle}</a>
		{#if event.type === 'like' && event.track}
			<span class="activity-verb">liked</span>
			<a href="/track/{event.track.id}" class="activity-track">{event.track.title}</a>
		{:else if event.type === 'comment' && event.track}
			<span class="activity-verb">commented on</span>
			<a href="/track/{event.track.id}" class="activity-track">{event.track.title}</a>
		{:else if event.type === 'join'}
			<span class="activity-verb">joined</span>
			<span class="activity-track">plyr.fm</span>
		{/if}
	</span>
	<span class="activity-time">{timeAgo(event.created_at)}</span>
</div>

<style>
	.activity-row {
		--type-color: var(--border-subtle);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		font-size: var(--text-xs);
		border-left: 2px solid var(--type-color);
		border-radius: var(--radius-sm);
		transition: background 0.15s;
	}

	.activity-row:hover {
		background: var(--bg-hover, transparent);
	}

	.activity-row.like { --type-color: #e0607e; }
	.activity-row.comment { --type-color: #a78bfa; }
	.activity-row.join { --type-color: #4ade80; }

	.activity-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--type-color);
		opacity: 0.7;
	}

	.activity-text {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.activity-actor {
		color: var(--text-primary);
		font-weight: 600;
		text-decoration: none;
	}

	.activity-actor:hover {
		color: var(--accent);
	}

	.activity-verb {
		color: var(--text-tertiary);
	}

	.activity-track {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
	}

	a.activity-track:hover {
		color: var(--accent);
	}

	.activity-time {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
</style>
