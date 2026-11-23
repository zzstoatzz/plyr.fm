<script lang="ts">
	import { followPlayingLevels } from './playing-levels';

	/** `live={false}` for someone else's listening: the bars only follow audio this page plays. */
	let { live = true }: { live?: boolean } = $props();
	let icon: HTMLElement | undefined = $state();
	$effect(() => live && icon ? followPlayingLevels(icon) : undefined);
</script>

<span class="playing-wave" bind:this={icon} data-testid="playing-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>

<style>
	.playing-wave { display: inline-flex; flex: 0 0 auto; width: 1.125rem; height: 1.125rem; justify-content: space-between; align-items: center; }
	i { width: 0.1875rem; height: 100%; background: currentColor; border-radius: 999px; transform: scaleY(var(--rest)); animation: playing-bars var(--period) ease-in-out var(--delay) infinite alternate; }
	i:nth-child(1) { --rest: 0.45; --period: 480ms; --delay: -90ms; --level: var(--wave-0); }
	i:nth-child(2) { --rest: 0.92; --period: 370ms; --delay: -370ms; --level: var(--wave-1); }
	i:nth-child(3) { --rest: 0.64; --period: 415ms; --delay: -220ms; --level: var(--wave-2); }
	i:nth-child(4) { --rest: 0.34; --period: 525ms; --delay: -40ms; --level: var(--wave-3); }
	.playing-wave:global([data-live]) i { animation: none; transform: scaleY(var(--level, var(--rest))); }
	@keyframes playing-bars { from { transform: scaleY(0.28); } to { transform: scaleY(0.95); } }
	@media (prefers-reduced-motion: reduce) { i, .playing-wave:global([data-live]) i { animation: none; transform: scaleY(var(--rest)); } }
</style>
