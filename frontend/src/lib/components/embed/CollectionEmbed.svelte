<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import { IMAGE_WIDTHS, resizedImageUrl } from '$lib/utils/display-image';
	import {
		clearMediaSessionMetadata,
		setMediaSessionActionHandlers,
		setMediaSessionMetadata,
		setMediaSessionPlaybackState,
		setMediaSessionPositionState
	} from '$lib/media-session';
	import { trackCoverUrl } from '$lib/track-cover';
	import type { CollectionData } from '$lib/types';

	let { collection }: { collection: CollectionData } = $props();

	let audio = $state<HTMLAudioElement>();
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let currentIndex = $state(0);

	let currentTrack = $derived(collection.tracks[currentIndex]);
	const hasAdultLabel = (track: (typeof collection.tracks)[number]) =>
		track.labels?.some((label) => label === 'sexual' || label === 'porn') ?? false;
	let isPlayable = $derived(
		currentTrack?.r2_url && !currentTrack?.gated && !hasAdultLabel(currentTrack)
	);
	let showCopied = $state(false);

	async function copyShareLink() {
		const url = collection.collectionUrl;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			if (navigator.share) {
				try {
					await navigator.share({ url });
				} catch {
					/* dismissed */
				}
			}
			return;
		}
		showCopied = true;
		setTimeout(() => {
			showCopied = false;
		}, 2000);
	}

	function togglePlay() {
		if (!isPlayable || !audio) return;
		if (audio.paused) {
			audio?.play().catch(() => {
				paused = true;
			});
		} else {
			audio?.pause();
		}
	}

	async function playTrack(index: number) {
		const track = collection.tracks[index];
		if (!track?.r2_url || track.gated || hasAdultLabel(track)) return;
		if (index === currentIndex && !paused) {
			audio?.pause();
		} else {
			currentIndex = index;
			await tick();
			audio?.play().catch(() => {
				paused = true;
			});
		}
	}

	async function skipPrev() {
		if (audio && currentTime > 3) {
			audio.currentTime = 0;
			return;
		}
		for (let i = currentIndex - 1; i >= 0; i--) {
			const t = collection.tracks[i];
			if (t.r2_url && !t.gated && !hasAdultLabel(t)) {
				currentIndex = i;
				await tick();
				audio?.play().catch(() => {});
				return;
			}
		}
	}

	async function skipNext() {
		for (let i = currentIndex + 1; i < collection.tracks.length; i++) {
			const t = collection.tracks[i];
			if (t.r2_url && !t.gated && !hasAdultLabel(t)) {
				currentIndex = i;
				await tick();
				audio?.play().catch(() => {});
				return;
			}
		}
		paused = true;
	}

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleSeek(event: Event & { currentTarget: HTMLInputElement }): void {
		if (audio && Number.isFinite(duration) && duration > 0) {
			audio.currentTime = event.currentTarget.valueAsNumber;
		}
	}

	onMount(() => {
		if ($page.url.searchParams.get('autoplay') === '1' && isPlayable) {
			audio?.play().catch(() => {
				paused = true;
			});
		}

		// route OS-level lock-screen / system-media controls to the embed's
		// own playback functions. without these, the lock-screen control
		// only knew that an `<audio>` element was playing — no title, no
		// artwork, and the next/previous buttons were ignored.
		setMediaSessionActionHandlers({
			play: () => {
				audio?.play().catch(() => {});
			},
			pause: () => {
				audio?.pause();
			},
			previoustrack: () => {
				void skipPrev();
			},
			nexttrack: () => {
				void skipNext();
			},
			seekto: (details) => {
				if (audio && details.seekTime !== undefined) {
					audio.currentTime = details.seekTime;
				}
			},
			seekbackward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset ?? 10));
			},
			seekforward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.min(duration, audio.currentTime + (details.seekOffset ?? 10));
			}
		});

		return () => {
			// clear metadata when the component unmounts so a stale embed
			// doesn't leave its title/cover hanging on the OS controls
			// after navigation away.
			clearMediaSessionMetadata();
			setMediaSessionPlaybackState('none');
			setMediaSessionActionHandlers({
				play: null,
				pause: null,
				previoustrack: null,
				nexttrack: null,
				seekto: null,
				seekbackward: null,
				seekforward: null
			});
		};
	});

	// keep the OS-level lock-screen metadata in sync with the current track
	$effect(() => {
		if (!currentTrack) return;
		setMediaSessionMetadata({
			title: currentTrack.title,
			artist: currentTrack.artist,
			album: collection.title,
			artworkUrl: trackCoverUrl(currentTrack),
			artworkFallbackUrl: collection.imageUrl
		});
	});

	$effect(() => {
		setMediaSessionPlaybackState(paused ? 'paused' : 'playing');
	});

	$effect(() => {
		setMediaSessionPositionState({ duration, position: currentTime });
	});
</script>

<div class="embed-container">
	<div class="art-container">
		{#if collection.imageUrl}
			<SensitiveImage src={collection.imageUrl} respectPreference={false}>
				<img src={collection.imageUrl} alt={collection.title} class="art" />
			</SensitiveImage>
		{:else}
			<div class="art-placeholder">&#9835;</div>
		{/if}
	</div>

	<div class="content">
		<div class="collection-header">
			<div class="meta">
				<a href={collection.collectionUrl} target="_blank" rel="noopener noreferrer" class="title"
					>{collection.title}</a
				>
				<span class="meta-sep">&middot;</span>
				<a href={collection.subtitleUrl} target="_blank" rel="noopener noreferrer" class="subtitle"
					>{collection.subtitle}</a
				>
			</div>
			<div class="actions">
				<button class="share-btn" onclick={copyShareLink} title="copy link">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						class="share-icon"
					>
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
					</svg>
					{#if showCopied}<span class="copied">copied!</span>{/if}
				</button>
				<a href="https://plyr.fm" target="_blank" rel="noopener noreferrer" class="logo">plyr.fm</a>
			</div>
		</div>

		<div class="track-list">
			{#each collection.tracks as track, i (track.id)}
				<button
					class="track-row"
					class:active={i === currentIndex}
					class:gated={!track.r2_url || track.gated || hasAdultLabel(track)}
					onclick={(e) => {
						if (e.composedPath().some((node) => node instanceof HTMLAnchorElement)) return;
						playTrack(i);
					}}
					disabled={!track.r2_url || track.gated || hasAdultLabel(track)}
				>
					<span class="track-num">
						{#if i === currentIndex && !paused}
							<span class="eq-bars"
								><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"
								></span></span
							>
						{:else}{i + 1}{/if}
					</span>
					<span class="track-title">{track.title}</span>
					<a
						class="track-artist"
						href="https://plyr.fm/u/{track.artist_handle}"
						target="_blank"
						rel="noopener noreferrer"
						onclick={(e) => e.stopPropagation()}>{track.artist}</a
					>
				</button>
			{/each}
			{#if collection.tracks.length === 0}
				<div class="empty">no tracks</div>
			{/if}
		</div>

		<div class="player-bar" class:is-playing={!paused}>
			<div class="now-playing">
				{#if currentTrack && trackCoverUrl(currentTrack)}
					<SensitiveImage src={trackCoverUrl(currentTrack)} compact respectPreference={false}>
						<img
							class="np-art"
							src={resizedImageUrl(trackCoverUrl(currentTrack), IMAGE_WIDTHS.thumb)}
							alt=""
						/>
					</SensitiveImage>
				{:else}
					<div class="np-art-placeholder">&#9835;</div>
				{/if}
				<div class="np-meta">
					{#if currentTrack?.id}
						<a
							class="np-title"
							href="https://plyr.fm/track/{currentTrack.id}"
							target="_blank"
							rel="noopener noreferrer">{currentTrack?.title ?? ''}</a
						>
					{:else}
						<span class="np-title">{currentTrack?.title ?? ''}</span>
					{/if}
					{#if currentTrack?.artist_handle}
						<a
							class="np-artist"
							href="https://plyr.fm/u/{currentTrack.artist_handle}"
							target="_blank"
							rel="noopener noreferrer">{currentTrack?.artist ?? ''}</a
						>
					{:else}
						<span class="np-artist">{currentTrack?.artist ?? ''}</span>
					{/if}
				</div>
				<div class="transport">
					<button class="ctrl-btn" onclick={skipPrev} aria-label="Previous">
						<svg viewBox="0 0 24 24" fill="currentColor" class="ctrl-icon"
							><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg
						>
					</button>
					<button
						class="play-btn"
						disabled={!isPlayable}
						onclick={togglePlay}
						aria-label={paused ? 'Play' : 'Pause'}
					>
						{#if paused}
							<svg viewBox="0 0 24 24" fill="currentColor" class="icon"
								><path d="M8 5v14l11-7z" /></svg
							>
						{:else}
							<svg viewBox="0 0 24 24" fill="currentColor" class="icon"
								><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg
							>
						{/if}
					</button>
					<button class="ctrl-btn" onclick={skipNext} aria-label="Next">
						<svg viewBox="0 0 24 24" fill="currentColor" class="ctrl-icon"
							><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg
						>
					</button>
				</div>
			</div>
			<div class="scrubber">
				<div class="time">{formatTime(currentTime)}</div>
				<input
					class="seek-bar"
					type="range"
					aria-label="Seek"
					min="0"
					max={Number.isFinite(duration) && duration > 0 ? duration : 1}
					step="0.1"
					value={Number.isFinite(currentTime) ? currentTime : 0}
					disabled={!Number.isFinite(duration) || duration <= 0}
					style={`--progress: ${duration > 0 ? (currentTime / duration) * 100 : 0}%`}
					oninput={handleSeek}
				/>
				<div class="time">{formatTime(duration)}</div>
			</div>
		</div>
	</div>

	{#if currentTrack?.r2_url && !currentTrack.gated && !hasAdultLabel(currentTrack)}
		<audio
			bind:this={audio}
			src={currentTrack.r2_url}
			bind:paused
			bind:currentTime
			bind:duration
			onended={skipNext}
		></audio>
	{/if}
</div>

<style>
	.embed-container {
		display: flex;
		height: 100%;
		padding: var(--embed-space);
		gap: var(--embed-space);
		background: var(--bg-secondary);
		color: var(--text-primary);
		overflow: hidden;
	}
	.art-container {
		flex: 0 0 auto;
		width: min(28vw, 200px, calc(100vh - 2 * var(--embed-space)));
		aspect-ratio: 1;
		align-self: center;
		position: relative;
	}
	.art {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
	}
	.art-placeholder {
		width: 100%;
		height: 100%;
		background: var(--bg-tertiary);
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		font-size: var(--text-3xl);
		color: var(--text-tertiary);
	}
	.content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--embed-gap);
	}
	.meta {
		min-width: 0;
	}
	.title {
		display: block;
		font-size: var(--text-lg);
		font-weight: 650;
		line-height: 1.4;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}
	.subtitle {
		display: block;
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}
	.title:hover,
	.subtitle:hover {
		text-decoration: underline;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.logo {
		color: var(--text-secondary);
		font-size: var(--text-xs);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.logo:hover {
		color: var(--text-primary);
	}
	.share-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		position: relative;
	}
	.share-icon {
		width: 16px;
		height: 16px;
	}
	.copied {
		position: absolute;
		right: 0;
		top: 100%;
		padding: 4px 8px;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-xs);
		z-index: 2;
	}
	.play-btn {
		display: grid;
		place-items: center;
		width: var(--embed-play);
		height: var(--embed-play);
		flex-shrink: 0;
		border: none;
		border-radius: var(--radius-full);
		background: var(--text-primary);
		color: var(--bg-primary);
		cursor: pointer;
	}
	.play-btn:hover:not(:disabled) {
		background: var(--accent);
	}
	.play-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon {
		width: 24px;
		height: 24px;
	}
	.time {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		min-width: 2.5em;
		text-align: center;
	}
	@media (max-width: 279px) {
		.art-container {
			display: none;
		}
		.logo {
			display: none;
		}
	}
	@media (max-width: 199px) {
		.time,
		.share-btn {
			display: none;
		}
	}

	.collection-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--embed-gap);
		padding-bottom: var(--embed-gap);
		border-bottom: 1px solid var(--border-subtle);
	}
	.meta-sep {
		display: none;
	}
	.track-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) transparent;
	}
	.track-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 36px;
		padding: 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.track-row:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.track-row.active {
		color: var(--accent);
	}
	.track-row.gated {
		opacity: 0.4;
		cursor: default;
	}
	.track-num {
		width: 1.5em;
		flex-shrink: 0;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.track-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		line-height: 1.4;
	}
	.track-artist {
		max-width: 35%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--text-secondary);
		text-decoration: none;
	}
	.track-artist:hover {
		text-decoration: underline;
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		padding: 8px;
	}
	.eq-bars {
		display: inline-flex;
		align-items: end;
		gap: 2px;
		height: 12px;
	}
	.eq-bar {
		width: 2px;
		height: 50%;
		background: currentColor;
	}
	.eq-bar:nth-child(2) {
		height: 100%;
	}
	.eq-bar:nth-child(3) {
		height: 70%;
	}
	.player-bar {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: var(--embed-gap);
		border-top: 1px solid var(--border-subtle);
	}
	.now-playing {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.np-art,
	.np-art-placeholder {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}
	.np-art-placeholder {
		display: grid;
		place-items: center;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.np-meta {
		flex: 1;
		min-width: 0;
	}
	.np-title,
	.np-artist {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.4;
		font-size: var(--text-sm);
		color: var(--text-primary);
		text-decoration: none;
	}
	.np-artist {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.ctrl-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 36px;
		background: none;
		color: var(--text-secondary);
		border: 0;
		cursor: pointer;
	}
	.ctrl-btn:hover {
		color: var(--text-primary);
	}
	.ctrl-icon {
		width: 18px;
		height: 18px;
	}
	.scrubber {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	@media (max-width: 499px) {
		.art-container {
			display: none;
		}
	}
	@media (max-width: 319px) {
		.np-art,
		.np-art-placeholder,
		.track-artist {
			display: none;
		}
		.collection-header {
			align-items: start;
		}
	}
	@media (max-height: 199px) {
		.track-list,
		.collection-header {
			display: none;
		}
		.content {
			justify-content: center;
		}
		.player-bar {
			border: 0;
			padding: 0;
		}
	}
</style>
