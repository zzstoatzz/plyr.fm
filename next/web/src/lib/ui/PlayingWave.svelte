<span class="playing-wave" data-testid="playing-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>

<style>
	.playing-wave { display: inline-flex; flex: 0 0 auto; width: 1.125rem; height: 1.125rem; justify-content: space-between; align-items: center; }
	i { width: 0.1875rem; height: 100%; background: currentColor; border-radius: 999px; transform: scaleY(var(--rest)); animation: playing-bars var(--period) ease-in-out var(--delay) infinite alternate; }
	i:nth-child(1) { --rest: 0.45; --period: 480ms; --delay: -90ms; }
	i:nth-child(2) { --rest: 0.92; --period: 370ms; --delay: -370ms; }
	i:nth-child(3) { --rest: 0.64; --period: 415ms; --delay: -220ms; }
	i:nth-child(4) { --rest: 0.34; --period: 525ms; --delay: -40ms; }
	@keyframes playing-bars { from { transform: scaleY(0.28); } to { transform: scaleY(0.95); } }
	@media (prefers-reduced-motion: reduce) { i { animation: none; } }
</style>
