<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import type { Track } from '$lib/types';

	interface CollectionData {
		title: string;
		subtitle: string;
		subtitleUrl: string;
		collectionUrl: string;
		imageUrl: string | null;
		tracks: Track[];
	}

	let { collection }: { collection: CollectionData } = $props();

	let audio: HTMLAudioElement = $state() as HTMLAudioElement;
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let currentIndex = $state(0);

	let currentTrack = $derived(collection.tracks[currentIndex]);
	let isPlayable = $derived(currentTrack?.r2_url && !currentTrack?.gated);

	function togglePlay() {
		if (!isPlayable) return;
		if (audio.paused) {
			audio.play();
		} else {
			audio.pause();
		}
	}

	async function playTrack(index: number) {
		const track = collection.tracks[index];
		if (!track?.r2_url || track.gated) return;
		if (index === currentIndex && !paused) {
			audio.pause();
		} else {
			currentIndex = index;
			await tick();
			audio.play().catch(() => { paused = true; });
		}
	}

	async function skipPrev() {
		if (currentTime > 3) {
			audio.currentTime = 0;
			return;
		}
		for (let i = currentIndex - 1; i >= 0; i--) {
			const t = collection.tracks[i];
			if (t.r2_url && !t.gated) {
				currentIndex = i;
				await tick();
				audio.play().catch(() => {});
				return;
			}
		}
	}

	async function skipNext() {
		for (let i = currentIndex + 1; i < collection.tracks.length; i++) {
			const t = collection.tracks[i];
			if (t.r2_url && !t.gated) {
				currentIndex = i;
				await tick();
				audio.play().catch(() => {});
				return;
			}
		}
		paused = true;
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleSeek(e: MouseEvent) {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const x = e.clientX - rect.left;
		audio.currentTime = (x / rect.width) * duration;
	}

	onMount(() => {
		if ($page.url.searchParams.get('autoplay') === '1' && isPlayable) {
			audio.play().catch(() => { paused = true; });
		}
	});
</script>

<div class="embed-container">
	{#if collection.imageUrl}
		<SensitiveImage src={collection.imageUrl}>
			<div class="bg-image" style="background-image: url({collection.imageUrl})"></div>
		</SensitiveImage>
	{/if}
	<div class="bg-overlay"></div>

	<div class="art-container">
		{#if collection.imageUrl}
			<SensitiveImage src={collection.imageUrl}>
				<img src={collection.imageUrl} alt={collection.title} class="art" />
			</SensitiveImage>
		{:else}
			<div class="art-placeholder">&#9835;</div>
		{/if}
	</div>

	<div class="content">
		<div class="collection-header">
			<div class="meta">
				<a href={collection.collectionUrl} target="_blank" rel="noopener noreferrer" class="title">{collection.title}</a>
				<span class="meta-sep">&middot;</span>
				<a href={collection.subtitleUrl} target="_blank" rel="noopener noreferrer" class="subtitle">{collection.subtitle}</a>
			</div>
			<a href="https://plyr.fm" target="_blank" rel="noopener noreferrer" class="logo">plyr.fm</a>
		</div>

		<div class="track-list">
			{#each collection.tracks as track, i (track.id)}
				<button
					class="track-row" class:active={i === currentIndex} class:gated={!track.r2_url || track.gated}
					onclick={(e) => {
						if ((e.target as HTMLElement).closest?.('a')) return;
						playTrack(i);
					}}
					disabled={!track.r2_url || track.gated}
				>
					<span class="track-num">
						{#if i === currentIndex && !paused}
							<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>
						{:else}{i + 1}{/if}
					</span>
					<span class="track-title">{track.title}</span>
					<a class="track-artist" href="https://plyr.fm/u/{track.artist_handle}" target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{track.artist}</a>
				</button>
			{/each}
			{#if collection.tracks.length === 0}
				<div class="empty">no tracks</div>
			{/if}
		</div>

		<div class="player-bar">
			<div class="now-playing">
				{#if currentTrack?.image_url}
					<img class="np-art" src={currentTrack.image_url} alt="" />
				{:else}
					<div class="np-art-placeholder">&#9835;</div>
				{/if}
				<div class="np-meta">
					{#if currentTrack?.id}
						<a class="np-title" href="https://plyr.fm/track/{currentTrack.id}" target="_blank" rel="noopener noreferrer">{currentTrack?.title ?? ''}</a>
					{:else}
						<span class="np-title">{currentTrack?.title ?? ''}</span>
					{/if}
					{#if currentTrack?.artist_handle}
						<a class="np-artist" href="https://plyr.fm/u/{currentTrack.artist_handle}" target="_blank" rel="noopener noreferrer">{currentTrack?.artist ?? ''}</a>
					{:else}
						<span class="np-artist">{currentTrack?.artist ?? ''}</span>
					{/if}
				</div>
				<div class="transport">
					<button class="ctrl-btn" onclick={skipPrev} aria-label="Previous">
						<svg viewBox="0 0 24 24" fill="currentColor" class="ctrl-icon"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
					</button>
					<button class="play-btn" onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
						{#if paused}
							<svg viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M8 5v14l11-7z" /></svg>
						{:else}
							<svg viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
						{/if}
					</button>
					<button class="ctrl-btn" onclick={skipNext} aria-label="Next">
						<svg viewBox="0 0 24 24" fill="currentColor" class="ctrl-icon"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
					</button>
				</div>
			</div>
			<div class="scrubber">
				<div class="time">{formatTime(currentTime)}</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="progress-bar" onclick={handleSeek}>
					<div class="progress-bg"></div>
					<div class="progress-fill" style="width: {(currentTime / (duration || 1)) * 100}%"></div>
				</div>
				<div class="time">{formatTime(duration)}</div>
			</div>
		</div>
	</div>

	{#if currentTrack?.r2_url && !currentTrack.gated}
		<audio
			bind:this={audio} src={currentTrack.r2_url}
			bind:paused bind:currentTime bind:duration
			onended={skipNext}
		></audio>
	{/if}
</div>

<style>
	:global(body) {
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	.embed-container {
		display: flex;
		height: 100%;
		background: var(--bg-tertiary);
		overflow: hidden;
		position: relative;
		container-type: size;
		--pad: clamp(8px, 4cqi, 16px);
		--gap: clamp(6px, 2cqi, 12px);
		--play-size: clamp(24px, 7cqi, 32px);
		--icon-size: clamp(14px, 5cqi, 20px);
		--ctrl-size: clamp(10px, 3.5cqi, 16px);
		--title-size: clamp(12px, 3.5cqi, 15px);
		--artist-size: clamp(10px, 3cqi, 13px);
		--time-size: clamp(10px, 2.5cqi, 12px);
		--logo-size: clamp(8px, 2cqi, 11px);
		--row-size: clamp(10px, 2.8cqi, 13px);
		--thumb-size: clamp(24px, 6cqi, 32px);
		/* color tokens — overridden by blurred-mode container queries */
		--c-title: var(--text-primary);
		--c-artist: var(--text-secondary);
		--c-ctrl: var(--text-secondary);
		--c-ctrl-hover: var(--text-primary);
		--c-logo: var(--border-emphasis);
		--c-logo-hover: var(--text-muted);
		--c-time: var(--text-tertiary);
		--c-progress-bg: var(--border-default);
		--c-progress-fill: var(--text-primary);
		--c-row: var(--text-secondary);
		--c-row-dim: var(--text-muted);
	}

	.bg-image {
		display: none;
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		filter: blur(24px);
		transform: scale(1.3);
		z-index: 0;
		pointer-events: none;
	}

	.bg-overlay {
		display: none;
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.5) 100%);
		z-index: 0;
		pointer-events: none;
	}

	.art-container {
		flex: 0 0 clamp(80px, 30cqi, 240px);
		height: 100%;
		position: relative;
	}

	.art { width: 100%; height: 100%; object-fit: cover; }

	.art-placeholder {
		width: 100%; height: 100%;
		background: var(--border-default);
		display: flex; align-items: center; justify-content: center;
		font-size: clamp(24px, 10cqi, 48px);
		color: var(--text-muted);
	}

	.content {
		flex: 1;
		padding: var(--pad);
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
		z-index: 1;
		gap: var(--gap);
	}

	.collection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--gap);
	}

	.ctrl-btn {
		background: none; border: none;
		color: var(--c-ctrl);
		cursor: pointer; padding: 2px;
		display: flex; align-items: center; justify-content: center;
	}
	.ctrl-btn:hover { color: var(--c-ctrl-hover); }
	.ctrl-icon { width: var(--ctrl-size); height: var(--ctrl-size); }

	.play-btn {
		width: var(--play-size); height: var(--play-size);
		border-radius: var(--radius-full);
		background: #fff; color: #000; border: none;
		display: flex; align-items: center; justify-content: center;
		cursor: pointer; flex-shrink: 0;
		transition: transform 0.1s;
	}
	.play-btn:active { transform: scale(0.95); }
	.icon { width: var(--icon-size); height: var(--icon-size); }

	.meta {
		min-width: 0; display: flex; align-items: baseline; gap: 0.4em;
		overflow: hidden;
	}

	.title {
		font-size: var(--title-size); font-weight: 700;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		text-decoration: none; color: var(--c-title); line-height: 1.3;
		flex-shrink: 1; min-width: 0;
	}
	.title:hover { text-decoration: underline; }

	.meta-sep {
		color: var(--c-artist); flex-shrink: 0;
		font-size: var(--artist-size);
	}

	.subtitle {
		font-size: var(--artist-size);
		color: var(--c-artist);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		text-decoration: none; line-height: 1.3;
		flex-shrink: 1; min-width: 0;
	}
	.subtitle:hover { text-decoration: underline; }

	.logo {
		font-size: var(--logo-size); font-weight: 700;
		color: var(--c-logo);
		text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px;
		white-space: nowrap; padding-top: 4px;
	}
	.logo:hover { color: var(--c-logo-hover); }

	.track-list {
		flex: 1; overflow-y: auto; min-height: 0;
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) transparent;
	}

	.track-row {
		display: flex; align-items: center; gap: 0.5em; width: 100%;
		padding: 3px 4px; border: none; background: none;
		color: var(--c-row); font-family: inherit; font-size: var(--row-size);
		cursor: pointer; text-align: left; border-radius: 3px; line-height: 1.4;
	}
	.track-row:hover:not(:disabled) { background: var(--bg-hover); }
	.track-row.active { color: var(--accent); }
	.track-row.gated { opacity: 0.35; cursor: default; }

	.track-num {
		flex: 0 0 1.5em; text-align: right;
		font-variant-numeric: tabular-nums; color: var(--c-row-dim);
	}
	.track-row.active .track-num { color: var(--accent); }

	.track-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.track-artist {
		flex: 0 1 auto; max-width: 30%;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		color: var(--c-row-dim); font-size: 0.9em;
		text-decoration: none;
	}
	.track-artist:hover { text-decoration: underline; }

	.empty { color: var(--text-muted); font-size: var(--row-size); padding: 8px 4px; }

	.eq-bars { display: inline-flex; align-items: flex-end; gap: 1px; height: 1em; }
	.eq-bar {
		display: inline-block; width: 2px; background: var(--accent);
		animation: eq 0.8s ease-in-out infinite alternate;
	}
	.eq-bar:nth-child(1) { height: 40%; animation-delay: 0s; }
	.eq-bar:nth-child(2) { height: 70%; animation-delay: 0.2s; }
	.eq-bar:nth-child(3) { height: 50%; animation-delay: 0.4s; }
	@keyframes eq { 0% { height: 20%; } 100% { height: 90%; } }

	.player-bar {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-top: 1px solid var(--c-progress-bg);
		padding-top: var(--gap);
	}

	.now-playing {
		display: flex;
		align-items: center;
		gap: var(--gap);
	}

	.np-art {
		width: var(--thumb-size);
		height: var(--thumb-size);
		border-radius: 3px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.np-art-placeholder {
		width: var(--thumb-size);
		height: var(--thumb-size);
		border-radius: 3px;
		background: var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: calc(var(--thumb-size) * 0.5);
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.np-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.np-title {
		font-size: var(--row-size);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--c-title);
		text-decoration: none;
	}
	a.np-title:hover { text-decoration: underline; }

	.np-artist {
		font-size: calc(var(--row-size) * 0.85);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--c-artist);
		text-decoration: none;
	}
	a.np-artist:hover { text-decoration: underline; }

	.transport {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.scrubber {
		display: flex;
		align-items: center;
		gap: var(--gap);
	}

	.time {
		font-size: var(--time-size); color: var(--c-time);
		font-variant-numeric: tabular-nums; min-width: 2.5em; text-align: center;
	}

	.progress-bar {
		flex: 1; height: clamp(20px, 6cqi, 28px);
		display: flex; align-items: center; cursor: pointer;
		position: relative; min-width: 40px;
	}
	.progress-bg {
		width: 100%; height: clamp(3px, 1cqi, 5px);
		background: var(--c-progress-bg); border-radius: 2px;
	}
	.progress-fill {
		position: absolute; left: 0; top: 50%; transform: translateY(-50%);
		height: clamp(3px, 1cqi, 5px);
		background: var(--c-progress-fill); border-radius: 2px; pointer-events: none;
	}
	.progress-bar:hover .progress-fill { background: var(--accent); }

	/* ===== NARROW (< 280px): blurred bg, hide art + track list ===== */
	@container (max-width: 279px) {
		.embed-container {
			--c-title: #fff; --c-artist: rgba(255,255,255,0.85);
			--c-ctrl: rgba(255,255,255,0.7); --c-ctrl-hover: #fff;
			--c-logo: rgba(255,255,255,0.5); --c-logo-hover: rgba(255,255,255,0.75);
			--c-time: rgba(255,255,255,0.6);
			--c-progress-bg: rgba(255,255,255,0.25); --c-progress-fill: #fff;
		}
		.bg-image, .bg-overlay { display: block; }
		.art-container, .track-list { display: none; }
		.np-art, .np-art-placeholder { display: none; }
		.content { justify-content: center; gap: clamp(4px, 1.5cqi, 8px); }
		.collection-header { flex-direction: column; gap: 0; }
		.meta { flex-wrap: wrap; }
		.meta-sep { display: none; }
		.title { text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
		.subtitle { text-shadow: 0 1px 4px rgba(0,0,0,0.4); }
		.logo { align-self: flex-start; }
		.player-bar { gap: 2px; }
	}

	/* ===== MICRO (< 200px): hide times, logo, np-meta ===== */
	@container (max-width: 199px) {
		.time, .logo, .np-meta { display: none; }
	}

	/* ===== TALL (aspect-ratio <= 1.2, >= 200px, >= 300px height): blurred bg, vertical ===== */
	@container (aspect-ratio <= 1.2) and (min-width: 200px) and (min-height: 300px) {
		.embed-container {
			flex-direction: column;
			--c-title: #fff; --c-artist: rgba(255,255,255,0.85);
			--c-ctrl: rgba(255,255,255,0.7); --c-ctrl-hover: #fff;
			--c-logo: rgba(255,255,255,0.5); --c-logo-hover: rgba(255,255,255,0.75);
			--c-time: rgba(255,255,255,0.6);
			--c-progress-bg: rgba(255,255,255,0.25); --c-progress-fill: #fff;
			--c-row: rgba(255,255,255,0.7); --c-row-dim: rgba(255,255,255,0.4);
		}
		.bg-image, .bg-overlay { display: block; }
		.art-container { display: none; }
		.content { flex: 1; }
		.title { text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
	}

	/* ===== WIDE (>= 500px): more room for artist column ===== */
	@container (min-width: 500px) {
		.track-artist { max-width: 40%; }
	}
</style>
