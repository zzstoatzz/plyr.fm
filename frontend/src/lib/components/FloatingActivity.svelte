<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import type { ActivityEvent } from '$lib/types';

	let events = $state<ActivityEvent[]>([]);

	function eventText(e: ActivityEvent): string {
		const name = e.actor.display_name || e.actor.handle.split('.')[0];
		switch (e.type) {
			case 'like': return `${name} liked`;
			case 'track': return `${name} uploaded`;
			case 'comment': return `${name} commented`;
			case 'join': return `${name} joined`;
		}
	}

	function rand(min: number, max: number): number {
		return Math.random() * (max - min) + min;
	}

	function bubbleStyle(): string {
		return [
			`--x:${rand(3, 92)}vw`,
			`--y:${rand(30, 90)}vh`,
			`--dx:${rand(-12, 12)}vw`,
			`--dy:${rand(-30, -12)}vh`,
			`--rot:${rand(-20, 20)}deg`,
			`--dur:${rand(14, 24)}s`,
			`--delay:${-rand(0, 20)}s`,
		].join(';');
	}

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/activity/?limit=15`);
			if (res.ok) events = (await res.json()).events ?? [];
		} catch { /* decorative — fail silently */ }
	});
</script>

{#if events.length > 0}
	<div class="activity-bg" aria-hidden="true">
		{#each events as event (event.created_at + event.actor.did)}
			<div class="bubble {event.type}" style={bubbleStyle()}>
				<span class="bubble-icon">
					{#if event.type === 'like'}
						<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
					{:else if event.type === 'track'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					{:else if event.type === 'comment'}
						<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
					{:else if event.type === 'join'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
					{/if}
				</span>
				<span class="bubble-text">{eventText(event)}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.activity-bg {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
	}

	.bubble {
		--peak: 0.5;
		position: absolute;
		left: var(--x);
		top: var(--y);
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem 0.3rem 0.4rem;
		font-size: 0.7rem;
		white-space: nowrap;
		opacity: 0;
		animation: rise var(--dur) var(--delay) ease-out infinite;
		will-change: transform, opacity;
	}

	/* type-specific shapes and colors */
	.bubble.like {
		color: #e0607e;
		background: color-mix(in srgb, #e0607e 10%, transparent);
		border: 1px solid color-mix(in srgb, #e0607e 20%, transparent);
		border-radius: 999px;
		box-shadow: 0 0 16px color-mix(in srgb, #e0607e 12%, transparent);
	}

	.bubble.track {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
		border-radius: 6px;
		box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.bubble.comment {
		color: #a78bfa;
		background: color-mix(in srgb, #a78bfa 10%, transparent);
		border: 1px solid color-mix(in srgb, #a78bfa 20%, transparent);
		border-radius: 10px 10px 10px 2px;
		box-shadow: 0 0 16px color-mix(in srgb, #a78bfa 12%, transparent);
	}

	.bubble.join {
		color: #4ade80;
		background: color-mix(in srgb, #4ade80 10%, transparent);
		border: 1px solid color-mix(in srgb, #4ade80 20%, transparent);
		border-radius: 999px;
		box-shadow: 0 0 16px color-mix(in srgb, #4ade80 12%, transparent);
	}

	.bubble-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.bubble-icon svg {
		width: 14px;
		height: 14px;
	}

	.bubble-text {
		font-weight: 500;
		opacity: 0.85;
	}

	/*
	 * visible for ~25% of cycle, invisible for 75%.
	 * with 14-24s total duration, each bubble is visible ~3-6s.
	 * negative delays mean elements start mid-cycle on page load
	 * instead of all fading in together.
	 */
	@keyframes rise {
		0% {
			opacity: 0;
			translate: 0 0;
			scale: 0.5;
			rotate: 0deg;
		}
		5% {
			opacity: var(--peak);
			scale: 1;
		}
		18% {
			opacity: calc(var(--peak) * 0.6);
		}
		25% {
			opacity: 0;
			translate: var(--dx) var(--dy);
			scale: 0.75;
			rotate: var(--rot);
		}
		26% {
			opacity: 0;
			translate: 0 0;
			scale: 0.5;
			rotate: 0deg;
		}
		100% {
			opacity: 0;
			translate: 0 0;
		}
	}

	/* mobile: fewer, subtler */
	.bubble:nth-child(n+6) { display: none; }

	@media (min-width: 769px) {
		.bubble:nth-child(n+6) { display: inline-flex; }
		.bubble:nth-child(n+11) { display: none; }
	}

	@media (max-width: 768px) {
		.bubble {
			--peak: 0.3;
			font-size: 0.6rem;
		}
		.bubble-icon svg { width: 11px; height: 11px; }
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-bg { display: none; }
	}
</style>
