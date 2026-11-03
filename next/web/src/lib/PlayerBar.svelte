<script lang="ts">
	// phones: a mini player above the tab bar (tap → now playing).
	// desktop: a full bar along the bottom.
	import LikeButton from './LikeButton.svelte';
	import { menus } from './menus.svelte';
	import Scrubber from './Scrubber.svelte';
	import Transport from './Transport.svelte';
	import { artistName, player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	const t = $derived(player.current);
	const pct = $derived(player.duration ? (player.time / player.duration) * 100 : 0);
</script>

{#if t}
	<div class="mini glass" role="region" aria-label="player">
		<button class="open" onclick={() => (menus.nowPlaying = true)} aria-label="open now playing">
			<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size={40} />
			<span class="meta">
				<span class="title ellipsis">{t.metadata.title}</span>
				<span class="artist ellipsis">{player.error ?? artistName(t)}</span>
			</span>
		</button>
		<LikeButton track={t} />
		<button class="btn ghost icon" onclick={() => player.toggle()} aria-label={player.playing ? 'pause' : 'play'}>
			<Icon name={player.playing ? 'pause' : 'play'} size={24} />
		</button>
		<span class="progress" style:width="{pct}%" aria-hidden="true"></span>
	</div>

	<div class="bar glass" role="region" aria-label="player">
		<div class="left">
			<button class="open" onclick={() => (menus.nowPlaying = true)} aria-label="open now playing">
				<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size={48} />
			</button>
			<span class="meta">
				<a class="title ellipsis" href="/track/{t.id}">{t.metadata.title}</a>
				<a class="artist ellipsis" href="/u/{t.artist.profile.handle}">{artistName(t)}</a>
			</span>
			<LikeButton track={t} />
		</div>
		<div class="center">
			<Transport />
			<div class="scrub">
				<span class="small muted time">{Math.floor(player.time / 60)}:{String(Math.floor(player.time % 60)).padStart(2, '0')}</span>
				<Scrubber compact />
				<span class="small muted time">{Math.floor(player.duration / 60)}:{String(Math.floor(player.duration % 60)).padStart(2, '0')}</span>
			</div>
			{#if player.error}<span class="error small">{player.error}</span>{/if}
		</div>
		<div class="right">
			<button class="btn ghost icon" onclick={() => (menus.nowPlaying = true)} aria-label="queue"><Icon name="queue" /></button>
			<button
				class="btn ghost icon"
				onclick={() => player.setVolume(player.volume > 0 ? 0 : 1)}
				aria-label={player.volume > 0 ? 'mute' : 'unmute'}
			>
				<Icon name={player.volume > 0 ? 'volume' : 'mute'} />
			</button>
			<input
				class="vol"
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={player.volume}
				style:--pct="{player.volume * 100}%"
				oninput={(e) => player.setVolume(+(e.currentTarget as HTMLInputElement).value)}
				aria-label="volume"
			/>
		</div>
	</div>
{/if}

<style>
	.mini {
		position: fixed;
		left: 0;
		right: 0;
		/* sits flush on the tab bar: the two read as one docked surface */
		bottom: calc(var(--tabbar) + env(safe-area-inset-bottom));
		z-index: 19;
		display: flex;
		align-items: center;
		gap: var(--s-xs);
		height: var(--mini);
		padding: var(--s-sm) var(--s-sm) var(--s-sm) var(--s-md);
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			0 -0.5rem 1.5rem rgb(0 0 0 / 0.08);
		overflow: hidden;
	}
	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-weight: 600;
	}
	.artist {
		font-size: var(--t-sm);
		color: var(--c-600);
	}
	.progress {
		position: absolute;
		left: 0;
		top: 0;
		height: 2px;
		background: var(--c-1000);
	}
	.bar {
		display: none;
	}
	@media (min-width: 800px) {
		.mini {
			display: none;
		}
		.bar {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 20;
			display: grid;
			grid-template-columns: 1fr minmax(20rem, 1.4fr) 1fr;
			align-items: center;
			gap: var(--s-lg);
			height: 4.5rem;
			padding: 0 var(--s-lg);
			box-shadow: inset 0 1px 0 var(--glass-edge);
		}
		.left {
			display: flex;
			align-items: center;
			gap: var(--s-md);
			min-width: 0;
		}
		.left .open {
			flex: none;
		}
		.center {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0;
		}
		.scrub {
			display: flex;
			align-items: center;
			gap: var(--s-sm);
			width: 100%;
		}
		.time {
			min-width: 2.5em;
			text-align: center;
			font-variant-numeric: tabular-nums;
		}
		.right {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: var(--s-xs);
		}
		.vol {
			-webkit-appearance: none;
			appearance: none;
			width: 6rem;
			height: 0.25rem;
			border-radius: var(--r-full);
			background: linear-gradient(to right, var(--c-1000) var(--pct), var(--c-100) var(--pct));
			cursor: pointer;
		}
		.vol::-webkit-slider-thumb {
			-webkit-appearance: none;
			width: 0.75rem;
			height: 0.75rem;
			border-radius: 50%;
			background: var(--c-1000);
		}
		.vol::-moz-range-thumb {
			width: 0.75rem;
			height: 0.75rem;
			border: 0;
			border-radius: 50%;
			background: var(--c-1000);
		}
	}
</style>
