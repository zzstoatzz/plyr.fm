<script lang="ts">
	import { player } from './player.svelte';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { artistName, clock } from './tracks';
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
		<button type="button" class="song" aria-label="Open now playing" {@attach pull.attach} onclick={event => player.openNowPlaying(event.detail === 0)}>
			<span class="cover"><Artwork src={trackArtwork(player.current)} size={48} /></span>
			<span class="description">
				<strong class="truncate">{player.current.metadata.title}</strong>
				<span class="subtitle">
					<span class="truncate">{player.liveStation ? `live · ${player.liveStation.label} radio` : player.outputElsewhere ? 'playing on another device' : artistName(player.current)}</span>
					{#if !player.liveStation && !player.outputElsewhere}<span class="mobile-time" aria-hidden="true">· {clock(player.position)}</span>{/if}
				</span>
			</span>
		</button>
		<div class="controls">
			<Transport compact />
			{#if !player.liveStation}<div class="desktop-progress"><Scrub /></div>{/if}
		</div>
		<div class="extras">
			<label class="volume">
				<Icon name={player.volume === 0 ? 'mute' : 'volume'} size={19} />
				<input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={player.volume} style:--fill={`${player.volume * 100}%`} oninput={event => player.setVolume(event.currentTarget.valueAsNumber)} />
			</label>
			{#if player.liveStation}
				<button type="button" class="icon-button" aria-label="Stop radio" onclick={() => player.stopRadio()}><Icon name="x" /></button>
			{:else}
				<button type="button" class="icon-button" aria-label="Queue" class:active={queuePage || player.queueOpen} aria-pressed={queuePage || player.queueOpen} onclick={onQueue}><Icon name="queue" /></button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.dock { position: fixed; z-index: 10; inset: auto 0 0; background: var(--surface); border-top: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 2fr) minmax(0, 1fr); gap: 1rem; padding: 0.4rem 1.25rem; min-height: var(--dock); align-items: center; }
	.song { display: flex; align-items: center; gap: 0.75rem; background: none; border: 0; min-width: 0; padding: 0; text-align: start; }
	.cover { width: 2.75rem; flex: none; border-radius: 0.4rem; }
	.description { display: grid; min-width: 0; }
	.subtitle { display: flex; gap: 0.25rem; }
	.mobile-time { display: none; flex-shrink: 0; font-variant-numeric: tabular-nums; }
	.description span { color: var(--muted); font-size: var(--t-12-8); }
	.controls { min-width: 0; display: flex; align-items: center; gap: 0.8rem; }
	.desktop-progress { flex: 1; min-width: 0; }
	.active { color: var(--accent); }
	.extras { display: flex; align-items: center; justify-content: flex-end; }
	.volume { display: flex; align-items: center; gap: 0.5rem; width: 7.5rem; }
	.mobile-progress { display: none; }
	@media (max-width: 720px) {
		.mobile-time { display: inline; }
		.song { touch-action: pan-x; }
		.dock { grid-template-columns: minmax(0, 1fr) auto auto; inset: auto 0.75rem var(--tabs); gap: 0.25rem; padding: 0.3rem 0.75rem; border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 1.25rem; background: color-mix(in srgb, var(--surface) 78%, transparent); -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7); box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.14); }
		.volume, .desktop-progress { display: none; }
		.mobile-progress { position: absolute; inset: -0.42rem 1rem auto; display: block; }
		.mobile-progress :global(input) { height: 0.65rem; }
	}
</style>
