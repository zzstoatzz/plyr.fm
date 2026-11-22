<script lang="ts">
	import { player } from './player.svelte';
	import { clock } from './tracks';

	// The phone mini player's progress: its own bottom edge. Sideways drags on the edge scrub; taps and vertical swipes don't.
	let band: HTMLDivElement | undefined = $state();
	let dragging: number | undefined = $state();
	let start: { x: number; y: number } | undefined;
	const enabled = $derived(player.duration > 0 && player.canSeek);
	const position = $derived(dragging ?? player.position);
	const fill = $derived(player.duration ? Math.min(100, Math.max(0, position / player.duration * 100)) : 0);

	// A track change or lost seek permission mid-drag drops the drag instead of seeking the old position.
	$effect(() => {
		void player.current;
		if (!enabled) cancel();
		return cancel;
	});

	function at(x: number) {
		const box = band!.getBoundingClientRect();
		return Math.max(0, Math.min(1, (x - box.left) / box.width)) * player.duration;
	}

	function down(event: PointerEvent) {
		if (!enabled || !event.isPrimary || event.button > 0) return;
		event.preventDefault();
		start = { x: event.clientX, y: event.clientY };
	}

	function move(event: PointerEvent) {
		if (!start || !event.isPrimary) return;
		if (event.buttons === 0) { cancel(); return; }
		if (dragging === undefined) {
			const across = Math.abs(event.clientX - start.x), vertical = Math.abs(event.clientY - start.y);
			if (vertical > 8 && vertical > across) { start = undefined; return; }
			if (across < 6) return;
			band!.setPointerCapture(event.pointerId);
		}
		dragging = at(event.clientX);
	}

	function up() {
		if (dragging !== undefined) player.seek(dragging);
		dragging = undefined;
		start = undefined;
	}

	function cancel() {
		dragging = undefined;
		start = undefined;
	}
</script>

<div class="lip" class:dragging={dragging !== undefined} style:--fill={`${fill}%`}>
	<span class="edge" aria-hidden="true"><i class="rail"></i><i class="played"></i></span>
	{#if dragging !== undefined}
		<span class="knob" aria-hidden="true"></span>
		<span class="bubble" aria-hidden="true">{clock(dragging)}</span>
	{/if}
	<div class="band" bind:this={band} aria-hidden="true" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel}
		onlostpointercapture={() => { if (dragging !== undefined) up(); }}></div>
	<input type="range" aria-label="Playback position" min="0" max={player.duration || 1} step="0.01" value={Math.min(position, player.duration)} disabled={!enabled}
		oninput={event => { dragging = event.currentTarget.valueAsNumber; }}
		onchange={event => { player.seek(event.currentTarget.valueAsNumber); dragging = undefined; }}
		onblur={() => { dragging = undefined; }} />
</div>

<style>
	.lip { display: none; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; z-index: 2; }
	.edge { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; }
	.edge i { position: absolute; inset: 0; border-radius: inherit; border: 0 solid transparent; border-bottom-width: 2px; transition: border-bottom-width 0.12s; }
	.edge .rail { border-bottom-color: color-mix(in srgb, var(--text) 14%, transparent); }
	.edge .played { border-bottom-color: var(--accent); clip-path: inset(0 calc(100% - var(--fill)) 0 0); }
	.dragging .edge i { border-bottom-width: 4px; }
	.knob { position: absolute; top: calc(100% - 2px); left: var(--fill); width: 14px; height: 14px; border-radius: 50%; background: var(--accent); transform: translate(-50%, -50%);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent), 0 1px 4px rgb(0 0 0 / 0.3); }
	.bubble { position: absolute; top: -2.4rem; left: clamp(1.5rem, var(--fill), calc(100% - 1.5rem)); transform: translateX(-50%); padding: 0.2rem 0.55rem; border-radius: 999px;
		background: var(--text); color: var(--surface); font-size: var(--t-12-8); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.3; white-space: nowrap; box-shadow: 0 0.25rem 0.8rem rgb(0 0 0 / 0.25); }
	.band { position: absolute; left: 0; right: 0; bottom: -0.25rem; height: 0.875rem; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; }
	input { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
	.lip:has(input:focus-visible) .edge i { border-bottom-width: 4px; }
	.lip:has(input:disabled) .band { pointer-events: none; }
	@media (max-width: 720px) { .lip { display: block; } }
	@media (prefers-reduced-motion: reduce) { .edge i { transition: none; } }
</style>
