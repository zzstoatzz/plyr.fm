<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { pullDirection } from '@plyr/next-core/behaviors/player-pull';
	import {
		BARS, armKick, barLight, barStep, pullKick, pullMove, refreshMessage, restingPull, resultHold, waveEndDelay, waveTarget,
		type Bar, type RefreshResult, type WavePhase
	} from '@plyr/next-core/behaviors/pull-refresh';

	// Pull the homepage down from the top on a phone to refresh it. The page has no native refresh
	// control on the web, so this draws its own rubber band, gap and spring back.
	let { onrefresh, children }: { onrefresh: () => Promise<RefreshResult>; children: Snippet } = $props();

	const THRESHOLD = 72;
	const HOLD = 56;
	const STRETCH = 230;

	let content: HTMLDivElement;
	let indicator: HTMLDivElement;
	let bars: HTMLElement[] = $state([]);
	let message = $state('');
	let announce = $state('');

	let offset = 0;
	let springVelocity = 0;
	let hold = 0;
	let phase: WavePhase | 'closing' = 'idle';
	let pull = restingPull;
	let wave: Bar[] = Array.from({ length: BARS }, () => ({ height: 0.12, velocity: 0 }));
	let touch: { id: number; x: number; y: number; state: 'waiting' | 'down' } | undefined;
	let frame = 0;
	let last = 0;
	let lastOffset = 0;
	let lastSpeed = 0;
	let started = 0;
	let reduced = false;

	const stretch = (distance: number) => STRETCH * (1 - 1 / (distance / STRETCH * 0.9 + 1));
	const unstretch = (shown: number) => shown <= 0 ? 0 : STRETCH * (1 / (1 - Math.min(shown, STRETCH - 1) / STRETCH) - 1) / 0.9;

	function buzz(ms: number) {
		try { navigator.vibrate?.(ms); } catch {}
	}

	function run() {
		if (!frame) frame = requestAnimationFrame(step);
	}

	function step(now: number) {
		frame = 0;
		const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
		last = now;
		if (!touch || touch.state !== 'down') {
			springVelocity += (-260 * (offset - hold) - 30 * springVelocity) * dt;
			offset += springVelocity * dt;
			if (hold === 0 && Math.abs(offset) < 0.4 && Math.abs(springVelocity) < 4) {
				offset = 0;
				springVelocity = 0;
				if (phase === 'closing') phase = 'idle';
			}
		}
		const speed = (offset - lastOffset) / dt;
		const speedChange = speed - lastSpeed;
		lastOffset = offset;
		lastSpeed = speed;
		const shown = Math.max(0, offset);
		content.style.transform = shown ? `translateY(${shown}px)` : '';
		const live = phase !== 'idle';
		indicator.style.opacity = String(Math.min(1, Math.max(0, (shown - (live ? 10 : 8)) / (live ? 30 : 26))));
		indicator.style.height = `${shown}px`;
		const progress = shown / THRESHOLD;
		const wavePhase = phase === 'closing' ? 'settled' : phase;
		const dragging = touch?.state === 'down' && phase === 'idle';
		wave = wave.map((bar, index) => {
			const target = waveTarget(index, wavePhase, progress, pull.armed, (now - started) / 1000);
			if (reduced) return { height: target, velocity: 0 };
			return barStep(dragging ? { ...bar, velocity: bar.velocity + pullKick(index, speedChange) } : bar, target, dt);
		});
		bars.forEach((element, index) => {
			// closing: the wave rests and shrinks with the gap instead of vanishing
			const height = Math.min(1.35, wave[index].height) * (phase === 'closing' ? Math.min(1, shown / HOLD) : 1);
			element.style.clipPath = `inset(${(1 - height / 1.35) * 50}% 0 round 0.375rem)`;
			element.style.opacity = message ? '0' : pull.armed || phase !== 'idle' ? '1' : String(0.45 + 0.55 * barLight(index, progress));
		});
		const resting = phase === 'idle' && !touch && offset === 0 && wave.every(bar => Math.abs(bar.velocity) < 0.01);
		if (!resting) run();
		else last = 0;
	}

	async function refresh() {
		phase = 'refreshing';
		started = performance.now();
		hold = HOLD;
		announce = 'refreshing';
		buzz(10);
		let result: RefreshResult;
		try { result = await onrefresh(); }
		catch { result = { ok: false }; }
		await new Promise(done => setTimeout(done, waveEndDelay(performance.now() - started)));
		const text = refreshMessage(result);
		const shown = resultHold(result);
		announce = text;
		buzz(result.ok ? 12 : 24);
		if (shown) {
			phase = 'settled';
			message = text;
			run();
			await new Promise(done => setTimeout(done, shown));
			message = '';
		}
		phase = 'closing';
		hold = 0;
		run();
	}

	function onStart(event: TouchEvent) {
		if (touch || event.touches.length !== 1 || window.scrollY > 0 || (phase !== 'idle' && phase !== 'closing')) return;
		if (document.querySelector('dialog[open]')) return;
		const point = event.touches[0];
		touch = { id: point.identifier, x: point.clientX, y: point.clientY - unstretch(Math.max(0, offset)), state: 'waiting' };
		pull = restingPull;
	}

	function onMove(event: TouchEvent) {
		if (!touch) return;
		const point = [...event.changedTouches].find(item => item.identifier === touch?.id);
		if (!point) return;
		const dy = point.clientY - touch.y;
		if (touch.state === 'waiting') {
			const direction = pullDirection(point.clientX - touch.x, dy);
			if (direction === 'blocked' || window.scrollY > 0) { touch = undefined; return; }
			if (direction === 'waiting') return;
			touch.state = 'down';
		}
		if (event.cancelable) event.preventDefault();
		offset = stretch(Math.max(0, dy));
		if (phase === 'idle') {
			const next = pullMove(pull, offset, THRESHOLD);
			pull = next.state;
			if (next.event === 'tick') buzz(4);
			if (next.event === 'arm') {
				buzz(14);
				if (!reduced) wave = wave.map((bar, index) => ({ ...bar, velocity: bar.velocity + armKick(index) }));
			}
		}
		run();
	}

	function onEnd(event: TouchEvent) {
		if (!touch || ![...event.changedTouches].some(item => item.identifier === touch?.id)) return;
		const fire = touch.state === 'down' && pull.armed && phase === 'idle';
		touch = undefined;
		pull = { ...pull, armed: false };
		if (fire) void refresh();
		run();
	}

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		reduced = motion.matches;
		const changed = () => { reduced = motion.matches; };
		motion.addEventListener('change', changed);
		// The browser's own pull-to-reload would fight this one on the homepage only.
		const root = document.documentElement;
		const overscroll = root.style.overscrollBehaviorY;
		root.style.overscrollBehaviorY = 'contain';
		const options = { passive: false } as const;
		window.addEventListener('touchstart', onStart, { passive: true });
		window.addEventListener('touchmove', onMove, options);
		window.addEventListener('touchend', onEnd);
		window.addEventListener('touchcancel', onEnd);
		return () => {
			cancelAnimationFrame(frame);
			motion.removeEventListener('change', changed);
			root.style.overscrollBehaviorY = overscroll;
			window.removeEventListener('touchstart', onStart);
			window.removeEventListener('touchmove', onMove);
			window.removeEventListener('touchend', onEnd);
			window.removeEventListener('touchcancel', onEnd);
		};
	});
</script>

<div class="pull" data-testid="pull-refresh">
	<div class="gap" bind:this={indicator} aria-hidden="true">
		<span class="bars">{#each { length: BARS } as _, index (index)}<i bind:this={bars[index]}></i>{/each}</span>
		<span class="message" class:on={!!message}>{message}</span>
	</div>
	<div class="content" bind:this={content}>{@render children()}</div>
	<p class="sr-only" role="status">{announce}</p>
</div>

<style>
	.pull { position: relative; }
	.gap { position: absolute; top: 0; left: 0; right: 0; height: 0; overflow: hidden; display: grid; place-items: center; opacity: 0; pointer-events: none; }
	.gap > * { grid-area: 1 / 1; }
	.bars { display: flex; align-items: center; gap: 0.3rem; height: 2.4rem; filter: drop-shadow(0 0 0.4rem color-mix(in srgb, var(--accent) 35%, transparent)); }
	.bars i { width: 0.375rem; height: 100%; border-radius: 0.375rem; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 72%, var(--c-1000, #fff)), var(--accent)); clip-path: inset(44% 0 round 0.375rem); opacity: 0.45; }
	.message { font-weight: 650; font-size: var(--t-14); color: var(--accent); white-space: nowrap; opacity: 0; transform: scale(0.85); transition: opacity 0.18s, transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1); }
	.message.on { opacity: 1; transform: none; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	@media (prefers-reduced-motion: reduce) { .message { transition: opacity 0.18s; transform: none; } }
</style>
