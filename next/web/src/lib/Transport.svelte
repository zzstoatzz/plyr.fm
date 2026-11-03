<script lang="ts">
	import { player } from './player.svelte';
	import Icon from './ui/Icon.svelte';

	let { big = false }: { big?: boolean } = $props();
</script>

<div class="transport" class:big>
	<button
		class="btn ghost icon mode"
		class:on={player.shuffle}
		onclick={() => player.toggleShuffle()}
		aria-label="shuffle"
		aria-pressed={player.shuffle}><Icon name="shuffle" size={20} /></button
	>
	<button class="btn ghost icon" onclick={() => player.prev()} aria-label="previous"><Icon name="prev_f" size={big ? 30 : 22} /></button>
	<button
		class="btn icon play"
		class:lg={big}
		onclick={() => player.toggle()}
		aria-label={player.playing ? 'pause' : 'play'}
		disabled={!player.current}
	>
		<Icon name={player.playing ? 'pause' : 'play'} size={big ? 28 : 20} />
	</button>
	<button class="btn ghost icon" onclick={() => player.next()} aria-label="next"><Icon name="next_f" size={big ? 30 : 22} /></button>
	<button
		class="btn ghost icon mode"
		class:on={player.repeat !== 'off'}
		onclick={() => player.cycleRepeat()}
		aria-label="repeat: {player.repeat}"
	>
		<Icon name="repeat" size={20} />
		{#if player.repeat === 'one'}<span class="one">1</span>{/if}
	</button>
</div>

<style>
	.transport {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--s-sm);
	}
	.big {
		justify-content: space-between;
	}
	.play {
		background: var(--c-1000);
		color: var(--c-0);
	}
	.play:hover {
		background: var(--c-900);
	}
	.mode {
		position: relative;
		color: var(--c-500);
	}
	.mode.on {
		color: var(--accent);
	}
	.one {
		position: absolute;
		top: 4px;
		right: 4px;
		font-size: 9px;
		font-weight: 800;
	}
</style>
