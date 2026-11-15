<script lang="ts">
	import { player } from './player.svelte';
	import { artistName } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Scrub from './Scrub.svelte';
	import Transport from './Transport.svelte';
	import LiveProgress from './radio/LiveProgress.svelte';

	let { close }: { close?: () => void } = $props();
</script>

{#if player.current}
	<div class="now">
		<header>
			{#if close}<button class="icon-button" type="button" aria-label="Close" onclick={close}><Icon name="down" /></button>{/if}
			<span>{player.liveStation ? `live · ${player.liveStation.label} radio` : 'now playing'}</span>
			{#if !player.liveStation}<a href="/queue" class="icon-button" aria-label="Queue" onclick={close}><Icon name="queue" /></a>{:else}<span></span>{/if}
		</header>
		<div class="cover" data-testid="now-playing-artwork"><Artwork src={trackArtwork(player.current)} size={460} eager /></div>
		<div class="copy">
			<h1 data-testid="now-playing-title">{player.current.metadata.title}</h1>
			<a class="subtle" href={`/u/${player.current.artist.did}`} onclick={close}>{artistName(player.current)}</a>
			{#if player.current.metadata.album}<p class="subtle">{player.current.metadata.album}</p>{/if}
			<div class="position">{#if player.liveStation}<LiveProgress />{:else}<Scrub />{/if}</div>
			<div class="commands" class:live={!!player.liveStation}>
				{#if !player.liveStation}<button class="icon-button" type="button" aria-label="Shuffle queue" onclick={() => player.shuffle()}><Icon name="shuffle" size={19} /></button>{/if}
				<Transport />
				{#if !player.liveStation}<button class="icon-button" type="button" aria-label={`Repeat ${player.repeat}`} aria-pressed={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name="repeat" size={19} /></button>{/if}
			</div>
			{#if player.error}<p class="state" role="status">{player.error}</p>{/if}
			{#if player.liveStation}<button class="text-button stop" onclick={() => { player.stopRadio(); close?.(); }}>leave radio</button>{/if}
			{#if player.privateMode}<a class="track-link" href="/private" onclick={close}>private music <span aria-hidden="true">→</span></a>
			{:else if !player.liveStation || player.current.id.startsWith('trk_')}<a class="track-link" href={`/track/${player.current.id}`} onclick={close}>view track <span aria-hidden="true">→</span></a>{/if}
			{#if player.current.metadata.description}<p class="description">{player.current.metadata.description}</p>{/if}
		</div>
	</div>
{:else}
	<div class="page-content"><h1>now playing</h1><p class="state">play a track to see it here.</p><a href="/">browse tracks</a></div>
{/if}

<style>
	.now { max-width: 33rem; margin: auto; padding: 0 1rem 2rem; }
	header { display: flex; align-items: center; justify-content: space-between; height: 3.5rem; color: var(--muted); font-size: 0.875rem; }
	.cover { border-radius: 0.8rem; width: 100%; }
	.copy { padding-top: 1.1rem; }
	h1 { font-size: clamp(1.35rem, 4vw, 2rem); line-height: 1.18; overflow-wrap: anywhere; margin-bottom: 0.35rem; }
	.position { margin-top: 1.1rem; }
	.commands { display: flex; justify-content: space-between; gap: 0.4rem; align-items: center; margin-block: 0.65rem; }
	.commands.live { justify-content: center; }
	.stop { display: flex; margin-inline: auto; }
	.track-link { display: flex; justify-content: space-between; padding-block: 0.65rem; border-bottom: 1px solid var(--line); }
	.description { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); margin-top: 1rem; }
</style>
