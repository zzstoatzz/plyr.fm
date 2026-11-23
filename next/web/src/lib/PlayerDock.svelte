<script lang="ts">
	import { resolve } from '$app/paths';
	import { player } from './player.svelte';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { artistName, clock } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Transport from './Transport.svelte';
	import Scrub from './Scrub.svelte';
	import MiniScrub from './MiniScrub.svelte';
	import LikeButton from './listening/LikeButton.svelte';
	import type { DockPull } from './dock-pull';

	let { onQueue, queuePage, pull }: { onQueue: () => void; queuePage: boolean; pull: DockPull } = $props();
</script>

{#if player.current}
	<div class="dock" data-testid="player-dock">
		{#if !player.liveStation}<MiniScrub />{/if}
		<div class="song">
			<button type="button" class="open" aria-label="Open now playing" {@attach pull.attach} onclick={event => player.openNowPlaying(event.detail === 0)}></button>
			<span class="cover"><Artwork src={trackArtwork(player.current)} size={48} /></span>
			<span class="description">
				<strong class="truncate">{player.current.metadata.title}</strong>
				<span class="subtitle">
					{#if player.liveStation}<span class="truncate">live · {player.liveStation.label} radio</span>
					{:else if player.outputElsewhere}<span class="truncate">playing on another device</span>
					{:else}<a class="artist truncate" href={resolve('/(app)/u/[actor]', { actor: player.current.artist.profile.handle || player.current.artist.did })}>{artistName(player.current)}</a>{/if}
					{#if !player.liveStation && !player.outputElsewhere}<span class="mobile-time" aria-hidden="true">· {clock(player.position)}</span>{/if}
				</span>
			</span>
			{#if !player.liveStation && !player.privateMode}<span class="like">{#key player.current.id}<LikeButton track={player.current} count={false} named />{/key}</span>{/if}
		</div>
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
	.song { position: relative; display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
	.open { position: absolute; inset: 0; background: none; border: 0; padding: 0; border-radius: 0.5rem; }
	.cover, .description { pointer-events: none; }
	.cover { width: 2.75rem; flex: none; border-radius: 0.4rem; }
	.description { display: grid; min-width: 0; }
	.artist, .like { position: relative; pointer-events: auto; }
	.like { flex: none; color: var(--muted); }
	.subtitle { display: flex; gap: 0.25rem; }
	.mobile-time { display: none; flex-shrink: 0; font-variant-numeric: tabular-nums; }
	.description span { color: var(--muted); font-size: var(--t-12-8); }
	.controls { min-width: 0; display: flex; align-items: center; gap: 0.8rem; }
	.desktop-progress { flex: 1; min-width: 0; }
	.active { color: var(--accent); }
	.extras { display: flex; align-items: center; justify-content: flex-end; }
	.volume { display: flex; align-items: center; gap: 0.5rem; width: 7.5rem; }
	@media (max-width: 720px) {
		.mobile-time { display: inline; }
		.open { touch-action: pan-x; }
		.artist { pointer-events: none; }
		.dock { grid-template-columns: minmax(0, 1fr) auto auto; inset: auto 0.75rem var(--tabs); gap: 0.25rem; padding: 0.3rem 0.75rem; border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 1.25rem; background: color-mix(in srgb, var(--surface) 78%, transparent); -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7); box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.14); }
		.volume, .desktop-progress { display: none; }
	}
</style>
