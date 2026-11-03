<script lang="ts">
	import { page } from '$app/state';
	import { api, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import LikeButton from '$lib/LikeButton.svelte';
	import { menus, share } from '$lib/menus.svelte';
	import { artistName, formatDuration, player } from '$lib/player.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	let track = $state<Track | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		const id = page.params.id!;
		track = null;
		error = null;
		api.track(id).then((t) => (track = t)).catch((e) => (error = e.message));
	});
	const playingThis = $derived(!!track && player.current?.id === track.id);
</script>

<ScreenHeader title="track">
	{#snippet slot()}
		{#if track}<button class="btn ghost icon" onclick={() => (menus.track = track)} aria-label="more"><Icon name="more" stroke={3} /></button>{/if}
	{/snippet}
</ScreenHeader>

{#if error}
	<p class="error pad">{error}</p>
{:else if track}
	<section class="hero">
		<div class="art"><Artwork src={track.media.artwork?.url} seed={track.metadata.title} size="100%" radius="var(--r-md)" /></div>
		<div class="info">
			<h1>{track.metadata.title}</h1>
			<a class="artist" href="/u/{track.artist.profile.handle}">
				<Artwork src={track.artist.profile.avatar_url} seed={track.artist.profile.handle} size={24} round />
				{artistName(track)}
			</a>
			<p class="muted small">
				{#if track.metadata.album}{track.metadata.album} · {/if}{track.metrics.play_count} plays · {track.metrics.like_count} likes
				{#if track.metadata.duration_seconds}· {formatDuration(track.metadata.duration_seconds)}{/if}
			</p>
		</div>
	</section>
	<div class="actions">
		<button
			class="btn primary icon lg"
			onclick={() => (playingThis ? player.toggle() : player.play([track!]))}
			aria-label={playingThis && player.playing ? 'pause' : 'play'}
		>
			<Icon name={playingThis && player.playing ? 'pause' : 'play'} size={24} />
		</button>
		<LikeButton {track} size="lg" />
		<button class="btn ghost icon lg" onclick={() => (auth.did ? (menus.addTo = track) : (location.href = '/login'))} aria-label="add to playlist">
			<Icon name="plus" size={26} />
		</button>
		<button class="btn ghost icon lg" onclick={() => (player.addToQueue(track!), toast.show('added to queue'))} aria-label="add to queue">
			<Icon name="queue" size={26} />
		</button>
		<button
			class="btn ghost icon lg"
			aria-label="share"
			onclick={async () => (await share(`/track/${track!.id}`, track!.metadata.title)) === 'copied' && toast.show('link copied')}
		>
			<Icon name="share" size={24} />
		</button>
	</div>
	{#if track.metadata.description}<p class="desc">{track.metadata.description}</p>{/if}
	<p class="uri muted"><small>{track.record.uri}</small></p>
{:else}
	<p class="empty">loading…</p>
{/if}

<style>
	.hero {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		padding: var(--s-lg);
	}
	.art {
		width: min(100%, 20rem);
		aspect-ratio: 1;
		align-self: center;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
	}
	h1 {
		font-size: var(--t-3xl);
		font-weight: 800;
	}
	.artist {
		display: inline-flex;
		align-items: center;
		gap: var(--s-sm);
		font-weight: 600;
	}
	p {
		margin: 0;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--s-xs);
		padding: 0 var(--s-lg) var(--s-md);
	}
	.desc {
		padding: var(--s-sm) var(--s-lg);
		white-space: pre-wrap;
	}
	.uri {
		padding: var(--s-lg);
		word-break: break-all;
	}
	@media (min-width: 500px) {
		.hero {
			flex-direction: row;
			align-items: flex-end;
		}
		.art {
			width: 12.5rem;
			flex-shrink: 0;
		}
	}
</style>
