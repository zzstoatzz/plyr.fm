<script lang="ts">
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { showsPause, tracksContext } from '@plyr/next-core/play-context';
	import { resolve } from '$app/paths';
	import { prefs } from './prefs.svelte';
	import { player } from './player.svelte';
	import { contextState, pressContext } from './play-control.svelte';
	import { artistName, clock, trackHref } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import PlayingWave from './ui/PlayingWave.svelte';
	import LikeButton from './listening/LikeButton.svelte';
	import Likers from './listening/Likers.svelte';
	import TrackActions from './listening/TrackActions.svelte';
	import { pressMenu } from './listening/press-menu';
	import { compactCount, postedAt } from './listening/format';

	let { track, collection, label, testid, number }: {
		track: Track; collection?: Track[]; label?: string; testid?: string;
		/** an album's position, shown in place of the cover its tracks all share */
		number?: number;
	} = $props();
	const context = $derived(tracksContext([track]));
	const playState = $derived(contextState(context));
	const currentTrack = $derived(playState !== 'idle');
	const playing = $derived(showsPause(playState));
	const title = $derived(track.metadata.title || 'untitled');
	let actions: ReturnType<typeof TrackActions> | undefined = $state();
	function toggle() {
		pressContext(context, () => prefs.playThrough ? player.play(track, collection, label) : player.play(track));
	}
</script>

<div class="track" class:numbered={number !== undefined} class:current={currentTrack} data-testid={testid} data-track-id={track.id} use:pressMenu={(x, y) => actions?.openAt(x, y)}>
	<button class="playback" type="button" data-testid="track-play-control" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} onclick={toggle}>
		<span class="cover">
			{#if number === undefined}<Artwork src={trackArtwork(track)} />{:else}<span class="number">{number}</span>{/if}
			<span class="play" class:playing>{#if playing}<PlayingWave />{:else}<Icon name="play" size={20} />{/if}</span>
		</span>
	</button>
	<div class="name">
		<a class="truncate title" href={trackHref(track)}>{title}</a>
		<a class="truncate artist" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>
		<div class="metrics"><span aria-label={`${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'play' : 'plays'}`}><Icon name="play" size={10} />{compactCount(track.metrics.play_count)}</span><Likers {track} /><time datetime={track.metadata.created_at}>{postedAt(track.metadata.created_at)}</time></div>
	</div>
	<div class="row-actions">
	<button class="icon-button add" type="button" aria-label={`Add ${title} to queue`} disabled={!player.canEditPublicQueue} title={!player.canEditPublicQueue ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" size={20} /></button>
	<LikeButton {track} count={false} named /><TrackActions bind:this={actions} {track} />
	</div>
	<span class="duration">{clock(track.metadata.duration_seconds)}</span>
</div>

<style>
	.track { -webkit-touch-callout: none; position: relative; display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) auto 3rem; align-items: center; gap: 0.75rem; min-height: 4.65rem; padding-inline: 0.75rem; margin-inline: -0.75rem; border-radius: 0.6rem; }
	.playback { display: block; border: 0; border-radius: 0.42rem; padding: 0; background: transparent; }
	.playback::after { content: ''; position: absolute; inset: 0; z-index: 1; }
	.cover { position: relative; display: block; border-radius: inherit; overflow: hidden; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
	.play.playing, .track:hover .play, .playback:focus-visible .play { opacity: 1; }
	.numbered { grid-template-columns: 2.25rem minmax(0, 1fr) auto 3rem; min-height: 3.5rem; }
	.number { display: grid; place-items: center; height: 2.25rem; color: var(--faint); font-variant-numeric: tabular-nums; }
	.numbered .play { background: var(--hover); color: var(--text); }
	.numbered.current .number, .numbered.current .title { color: var(--accent); }
	.numbered .artist { display: none; }
	.name { display: grid; justify-items: start; min-width: 0; }
	.name a { position: relative; z-index: 2; max-width: 100%; }
	.title { font-weight: 650; }
	.artist, .duration { color: var(--muted); font-size: var(--t-14); }
	.metrics { position: relative; z-index: 2; display: flex; align-items: center; gap: 0.8rem; color: var(--faint); font-size: var(--t-12); min-height: 1.4rem; }
	.metrics time { white-space: nowrap; }
	.metrics > span { display: flex; align-items: center; gap: 0.3rem; }
	.row-actions { position: relative; z-index: 2; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
	.track:hover, .track:focus-within { background: var(--hover); }
	.duration { text-align: end; font-variant-numeric: tabular-nums; }
	.add { position: relative; z-index: 2; color: var(--muted); }
	@media (hover: hover) { .track:not(:hover, :focus-within) .row-actions > :global(:not(.liked)) { opacity: 0; } }
	@media (max-width: 520px) { .track { grid-template-columns: 3.25rem minmax(0, 1fr) auto; padding-inline: 0.5rem; margin-inline: -0.5rem; } .numbered { grid-template-columns: 2.25rem minmax(0, 1fr) auto 2.75rem; } .numbered .metrics, .numbered .row-actions > :global(:nth-child(-n+2)) { display: none; } .numbered .duration { display: block; } .duration, .metrics time { display: none; } }
</style>
