<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import type { ActivityEvent } from '$lib/types';

	let events = $state<ActivityEvent[]>([]);

	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '…' : text;
	}

	function eventLabel(event: ActivityEvent): string {
		const handle = truncate(`@${event.actor.handle}`, 18);
		if (event.type === 'like' && event.track) return `${handle} liked ${truncate(event.track.title, 12)}`;
		if (event.type === 'track' && event.track) return `${handle} uploaded ${truncate(event.track.title, 12)}`;
		if (event.type === 'comment' && event.track) return `${handle} commented on ${truncate(event.track.title, 12)}`;
		if (event.type === 'join') return `${handle} joined`;
		return '';
	}

	function rand(min: number, max: number): number {
		return Math.random() * (max - min) + min;
	}

	function pillStyle(_index: number): string {
		const startX = rand(5, 85);
		const startY = rand(5, 85);
		const dx = rand(-20, 20);
		const dy = rand(-20, 20);
		const duration = rand(25, 45);
		const delay = rand(0, 20);
		return [
			`--start-x:${startX}%`,
			`--start-y:${startY}%`,
			`--dx:${dx}vw`,
			`--dy:${dy}vh`,
			`--dur:${duration}s`,
			`--delay:${delay}s`,
		].join(';');
	}

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/activity/?limit=15`);
			if (res.ok) {
				const data = await res.json();
				events = data.events ?? [];
			}
		} catch {
			// decorative — fail silently
		}
	});
</script>

{#if events.length > 0}
	<div class="floating-activity" aria-hidden="true">
		{#each events as event, i (event.created_at + event.actor.did)}
			<div class="pill {event.type}" style={pillStyle(i)}>
				<span class="pill-icon">
					{#if event.type === 'like'}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
					{:else if event.type === 'track'}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					{:else if event.type === 'comment'}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
					{:else if event.type === 'join'}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
					{/if}
				</span>
				<span class="pill-text">{eventLabel(event)}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.floating-activity {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
	}

	.pill {
		--type-color: var(--border-subtle);
		position: absolute;
		left: var(--start-x);
		top: var(--start-y);
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--track-bg, var(--bg-secondary)) 70%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--glass-border, var(--border-subtle));
		border-left: 2px solid var(--type-color);
		font-size: var(--text-xs, 0.75rem);
		color: var(--text-tertiary);
		white-space: nowrap;
		opacity: 0;
		animation: drift var(--dur) var(--delay) ease-in-out infinite;
		will-change: transform, opacity;
	}

	.pill.like { --type-color: #e0607e; }
	.pill.track { --type-color: var(--accent); }
	.pill.comment { --type-color: #a78bfa; }
	.pill.join { --type-color: #4ade80; }

	.pill-icon {
		display: flex;
		align-items: center;
		color: var(--type-color);
		opacity: 0.7;
		flex-shrink: 0;
	}

	.pill-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* mobile: only show first 5 pills */
	.pill:nth-child(n+6) {
		display: none;
	}

	@media (min-width: 769px) {
		.pill:nth-child(n+6) {
			display: inline-flex;
		}
		/* desktop: hide pills beyond 10 */
		.pill:nth-child(n+11) {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.pill {
			--pill-max-opacity: 0.3;
			font-size: 0.625rem;
			padding: 0.25rem 0.5rem;
			gap: 0.25rem;
		}
	}

	@keyframes drift {
		0% {
			transform: translate(0, 0);
			opacity: 0;
		}
		10% {
			opacity: var(--pill-max-opacity, 0.5);
		}
		85% {
			opacity: var(--pill-max-opacity, 0.5);
		}
		100% {
			transform: translate(var(--dx), var(--dy));
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.floating-activity {
			display: none;
		}
	}
</style>
