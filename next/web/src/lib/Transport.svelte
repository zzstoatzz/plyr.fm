<script lang="ts">
	import { player } from './player.svelte';
	import Icon from './ui/Icon.svelte';
	const playing = $derived(player.liveStation ? player.liveListening : player.playing && !player.outputElsewhere);
	let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="transport" class:compact>
	{#if !player.liveStation}<button type="button" class="icon-button previous" aria-label="Previous track" onclick={() => player.previous()}><Icon name="prev_f" size={21} /></button>{/if}
	<button type="button" class="primary-button toggle" aria-label={playing ? 'Pause' : player.liveStation ? 'Listen live' : 'Play'} onclick={() => player.toggle()}>
		<Icon name={playing ? 'pause' : 'play'} size={23} />
	</button>
	{#if !player.liveStation}<button type="button" class="icon-button" aria-label="Next track" onclick={() => player.next()}><Icon name="next_f" size={21} /></button>{/if}
</div>

<style>
	.transport { display: flex; align-items: center; justify-content: center; gap: 0.3rem; }
	.compact .toggle { background: var(--text); color: var(--surface); }
	.transport:not(.compact) .toggle { width: 3.6rem; height: 3.6rem; }
	@media (max-width: 720px) { .compact .previous { display: none; } }
</style>
