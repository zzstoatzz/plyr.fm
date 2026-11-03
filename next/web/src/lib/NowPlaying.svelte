<script lang="ts">
	// full-screen on phones, a dialog on desktop: big art, scrubber, transport,
	// and the queue one tap away.
	import LikeButton from './LikeButton.svelte';
	import { menus } from './menus.svelte';
	import Queue from './Queue.svelte';
	import Scrubber from './Scrubber.svelte';
	import Transport from './Transport.svelte';
	import { artistName, player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Sheet from './ui/Sheet.svelte';

	let showQueue = $state(false);
	const t = $derived(player.current);
</script>

<Sheet open={menus.nowPlaying && !!t} onclose={() => ((menus.nowPlaying = false), (showQueue = false))} full>
	{#if t}
		<div class="np">
			<div class="bar">
				<button class="btn ghost icon" onclick={() => (menus.nowPlaying = false)} aria-label="close now playing"><Icon name="down" /></button>
				<span class="small muted">{showQueue ? 'queue' : 'now playing'}</span>
				<button class="btn ghost icon" onclick={() => (menus.track = t)} aria-label="more"><Icon name="more" stroke={3} /></button>
			</div>

			{#if showQueue}
				<div class="queue"><Queue /></div>
			{:else}
				<div class="art">
					<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size="100%" radius="var(--r-md)" />
				</div>
			{/if}

			<div class="info">
				<div class="meta">
					<a class="title ellipsis" href="/track/{t.id}" onclick={() => (menus.nowPlaying = false)}>{t.metadata.title}</a>
					<a class="artist ellipsis" href="/u/{t.artist.profile.handle}" onclick={() => (menus.nowPlaying = false)}>{artistName(t)}</a>
				</div>
				<LikeButton track={t} size="lg" />
			</div>
			{#if player.error}<p class="error small">{player.error}</p>{/if}
			<Scrubber />
			<Transport big />
			<div class="foot">
				<button class="btn ghost sm" class:on={showQueue} onclick={() => (showQueue = !showQueue)} aria-pressed={showQueue}>
					<Icon name="queue" size={18} /> queue · {player.upcoming.length}
				</button>
			</div>
		</div>
	{/if}
</Sheet>

<style>
	.np {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		height: 100%;
		max-width: 480px;
		margin: 0 auto;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.art {
		width: 100%;
		aspect-ratio: 1;
		flex-shrink: 1;
		min-height: 0;
		margin: auto 0;
		box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
		border-radius: var(--r-md);
	}
	.queue {
		flex: 1;
		min-height: 0;
		overflow: auto;
		margin: 0 calc(-1 * var(--s-lg));
	}
	.info {
		display: flex;
		align-items: center;
		gap: var(--s-md);
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-size: var(--t-2xl);
		font-weight: 700;
	}
	.artist {
		color: var(--c-600);
	}
	.foot {
		display: flex;
		justify-content: center;
	}
	.on {
		color: var(--accent);
	}
	@media (min-width: 800px) {
		.art {
			max-width: 360px;
			align-self: center;
		}
		.queue {
			max-height: 360px;
		}
	}
</style>
