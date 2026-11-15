<script lang="ts">
	import { player } from './player.svelte';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { artistName } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Transport from './Transport.svelte';
	import Scrub from './Scrub.svelte';
	import type { DockPull } from './dock-pull';

	let { onQueue, queuePage, pull }: { onQueue: () => void; queuePage: boolean; pull: DockPull } = $props();
</script>

{#if player.current}
	<div class="dock" data-testid="player-dock">
		{#if !player.liveStation}<div class="mobile-progress"><Scrub clockLabels={false} /></div>{/if}
		<button type="button" class="song" aria-label="Open now playing" {@attach pull.attach} onclick={() => { player.nowPlaying = true; }}>
			<span class="cover"><Artwork src={trackArtwork(player.current)} size={48} /></span>
			<span class="description">
				<strong class="truncate">{player.current.metadata.title}</strong>
				<span class="truncate">{player.liveStation ? `live · ${player.liveStation.label} radio` : player.outputElsewhere ? 'playing on another device' : artistName(player.current)}</span>
			</span>
		</button>
		<div class="controls">
			<Transport compact />
			{#if !player.liveStation}<div class="desktop-progress"><Scrub /></div>{/if}
		</div>
		<div class="extras">
			<label class="volume">
				<Icon name={player.volume === 0 ? 'mute' : 'volume'} size={19} />
				<input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={player.volume} oninput={event => player.setVolume(event.currentTarget.valueAsNumber)} />
			</label>
			{#if player.liveStation}
				<button type="button" class="icon-button" aria-label="Stop radio" onclick={() => player.stopRadio()}><Icon name="x" /></button>
			{:else}
				<button type="button" class="icon-button" aria-label="Queue" aria-pressed={queuePage || player.queueOpen} disabled={queuePage} onclick={onQueue}><Icon name="queue" /></button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.dock { position: fixed; z-index: 10; inset: auto 0 0; background: var(--surface); border-top: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 2fr) minmax(0, 1fr); gap: 1rem; padding: 0.4rem 1.25rem; min-height: var(--dock); align-items: center; }
	.song { display: flex; align-items: center; gap: 0.75rem; background: none; border: 0; min-width: 0; padding: 0; text-align: start; }
	.cover { width: 2.75rem; flex: none; border-radius: 0.4rem; }
	.description { display: grid; min-width: 0; }
	.description span { color: var(--muted); font-size: 0.8rem; }
	.controls { min-width: 0; display: flex; align-items: center; gap: 0.8rem; }
	.desktop-progress { flex: 1; min-width: 0; }
	.extras { display: flex; align-items: center; justify-content: flex-end; }
	.volume { display: flex; align-items: center; gap: 0.5rem; width: 7.5rem; }
	.mobile-progress { display: none; }
	@media (max-width: 720px) {
		.song { touch-action: pan-x; }
		.dock { grid-template-columns: minmax(0, 1fr) auto; bottom: calc(var(--tabs) + env(safe-area-inset-bottom)); gap: 0.25rem; padding: 0.3rem 0.75rem; }
		.extras, .desktop-progress { display: none; }
		.mobile-progress { position: absolute; inset: -0.42rem 0 auto; display: block; }
		.mobile-progress :global(input) { height: 0.65rem; }
	}
</style>
