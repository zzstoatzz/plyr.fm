<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import type { ActivityEvent } from '$lib/types';

	interface Slot {
		event: ActivityEvent | null;
		visible: boolean;
		x: number;
		y: number;
		dx: number;
		dy: number;
		ping: boolean;
	}

	const SLOT_COUNT = 6;

	let events = $state<ActivityEvent[]>([]);
	let slots = $state<Slot[]>(
		Array.from({ length: SLOT_COUNT }, () => ({
			event: null,
			visible: false,
			x: 50,
			y: 50,
			dx: 0,
			dy: 0,
			ping: false
		}))
	);

	function label(e: ActivityEvent): string {
		const name = e.actor.display_name || e.actor.handle.split('.')[0];
		switch (e.type) {
			case 'like':
				return `${name} liked`;
			case 'track':
				return `${name} uploaded`;
			case 'comment':
				return `${name} commented`;
			case 'join':
				return `${name} joined`;
		}
	}

	const icons: Record<string, string> = {
		like: '♥',
		track: '↑',
		comment: '◆',
		join: '+'
	};

	function rand(min: number, max: number): number {
		return Math.random() * (max - min) + min;
	}

	const timers: ReturnType<typeof setTimeout>[] = [];

	onMount(() => {
		loadAndStart();
		return () => timers.forEach(clearTimeout);
	});

	async function loadAndStart() {
		try {
			const res = await fetch(`${API_URL}/activity/?limit=20`);
			if (!res.ok) return;
			events = (await res.json()).events ?? [];
		} catch {
			return;
		}

		if (events.length === 0) return;

		let cursor = 0;

		function cycle(i: number) {
			const event = events[cursor % events.length];
			cursor++;

			slots[i] = {
				event,
				visible: true,
				x: rand(4, 90),
				y: rand(12, 82),
				dx: rand(-12, 12),
				dy: rand(-30, -8),
				ping: true
			};

			// end ping after animation completes
			timers.push(
				setTimeout(() => {
					slots[i] = { ...slots[i], ping: false };
				}, 1800)
			);

			const visibleMs = rand(2800, 4200);
			const hiddenMs = rand(1200, 2600);

			timers.push(
				setTimeout(() => {
					slots[i] = { ...slots[i], visible: false };
					timers.push(setTimeout(() => cycle(i), hiddenMs));
				}, visibleMs)
			);
		}

		// stagger starts with prime-ish intervals to avoid sync
		const staggers = [0, 1100, 2300, 3700, 5300, 6700];
		for (let i = 0; i < SLOT_COUNT; i++) {
			timers.push(setTimeout(() => cycle(i), staggers[i]));
		}
	}
</script>

{#if events.length > 0}
	<div class="echoes" aria-hidden="true">
		{#each slots as slot, i (i)}
			<span
				class="echo {slot.event?.type ?? ''}"
				class:visible={slot.visible}
				style="left:{slot.x}%;top:{slot.y}%;--dx:{slot.dx}px;--dy:{slot.dy}px"
			>
				{#if slot.event}
					<span class="icon">{icons[slot.event.type]}</span>{label(slot.event)}
				{/if}
				{#if slot.ping}
					<span class="ring"></span>
				{/if}
			</span>
		{/each}
	</div>
{/if}

<style>
	.echoes {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
	}

	.echo {
		position: absolute;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		white-space: nowrap;
		opacity: 0;
		translate: 0 0;
		transition:
			opacity 1.4s ease-out,
			translate 4s ease-out;
	}

	.echo.visible {
		opacity: 0.35;
		translate: var(--dx) var(--dy);
		transition:
			opacity 0.4s ease-out,
			translate 4s ease-out;
	}

	.icon {
		margin-right: 0.3em;
	}

	/* type colors with soft glow */
	.echo.like {
		color: #e0607e;
		text-shadow: 0 0 20px color-mix(in srgb, #e0607e 35%, transparent);
	}

	.echo.track {
		color: var(--accent);
		text-shadow: 0 0 20px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.echo.comment {
		color: #a78bfa;
		text-shadow: 0 0 20px color-mix(in srgb, #a78bfa 35%, transparent);
	}

	.echo.join {
		color: #4ade80;
		text-shadow: 0 0 20px color-mix(in srgb, #4ade80 35%, transparent);
	}

	/* sonar ring that expands outward on appear */
	.ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
		border-radius: 50%;
		border: 1px solid currentColor;
		opacity: 0;
		transform: translate(-50%, -50%);
		animation: ping 1.8s ease-out forwards;
		pointer-events: none;
	}

	@keyframes ping {
		0% {
			width: 0;
			height: 0;
			opacity: 0.25;
		}
		100% {
			width: 80px;
			height: 80px;
			opacity: 0;
		}
	}

	/* mobile: fewer slots, subtler */
	.echo:nth-child(n + 4) {
		display: none;
	}

	@media (min-width: 769px) {
		.echo:nth-child(n + 4) {
			display: block;
		}
	}

	@media (max-width: 768px) {
		.echo {
			font-size: 0.6rem;
		}

		.echo.visible {
			opacity: 0.22;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.echoes {
			display: none;
		}
	}
</style>
