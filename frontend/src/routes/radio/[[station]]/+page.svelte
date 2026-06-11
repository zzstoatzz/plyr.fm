<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { radio } from '$lib/radio.svelte';
	import { horizontalSwipe } from '$lib/horizontal-swipe';
	import TunerDial from '$lib/components/radio/TunerDial.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import LikeButton from '$lib/components/LikeButton.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const endpoint = `${API_URL}/radio/state`;

	// the URL path is the source of truth for the selected station (bookmarkable).
	// `/radio` (no slug) shows the remembered/default station; `/radio/<slug>` pins it.
	let stationParam = $derived($page.params.station ?? null);
	let activeSlug = $derived(radio.state?.station_slug ?? radio.station);

	// react ONLY to the URL param. untrack so reads of radio.state inside show()
	// don't subscribe this effect (that would re-fire on every state reload).
	$effect(() => {
		const slug = stationParam;
		untrack(() => radio.show(slug));
	});

	// `?autoplay=1` tunes in automatically once the station's on-air track loads
	// (same convention as the track embed). built for embeds like an OBS browser
	// overlay where there's no chance to click "tune in". in a normal browser
	// without a prior gesture the play() is blocked by autoplay policy and
	// playRadio's catch quietly leaves it paused — no error, just no sound.
	let autoplayRequested = $derived($page.url.searchParams.get('autoplay') === '1');
	// fire once: tune in the moment a current track exists and we're not already on air.
	let autoTuned = false;
	$effect(() => {
		if (!autoplayRequested || autoTuned) return;
		if (!radio.current || radio.active) return;
		autoTuned = true;
		// play/pause button infinite loops without setTimeout
		setTimeout(() => radio.tuneIn(), 0);
	});

	/** select a station by navigating, so the URL (and bookmarks/back) stay in sync */
	function tuneToStation(slug: string) {
		goto(`/radio/${slug}`, { keepFocus: true, noScroll: true });
	}

	function flip(direction: 'next' | 'prev') {
		const next = radio.nextStationSlug(direction);
		if (next) tuneToStation(next);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
			return;
		if (event.key === 'ArrowRight') flip('next');
		else if (event.key === 'ArrowLeft') flip('prev');
	}

	// link preview — a stable station identity, not a per-moment "now playing"
	// (the on-air track changes constantly and scrapers cache the snapshot).
	// per-station when the path names one (data.station, resolved server-side),
	// else a concise generic radio card.
	const RADIO_OG_IMAGE = `${APP_CANONICAL_URL}/icons/icon-512.png`;
	let ogTitle = $derived(
		data.station ? `${data.station.name} · ${APP_NAME} radio` : `${APP_NAME} radio`
	);
	let ogDescription = $derived(
		data.station ? data.station.description : 'live radio from across plyr.fm'
	);
	let ogUrl = $derived(
		data.station ? `${APP_CANONICAL_URL}/radio/${data.station.slug}` : `${APP_CANONICAL_URL}/radio`
	);

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	let progressPercent = $derived(
		radio.current && radio.current.duration > 0
			? Math.min(100, (radio.positionSeconds / radio.current.duration) * 100)
			: 0
	);

	function formatTime(seconds: number): string {
		const t = Math.max(0, Math.floor(seconds));
		return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
	}

	onMount(() => {
		// lineup for the pills; the $effect above loads the selected station's state
		if (radio.stations.length === 0) radio.loadStations();
	});
</script>

<svelte:head>
	<title>{ogTitle}</title>
	<meta name="description" content={ogDescription} />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="og:image" content={RADIO_OG_IMAGE} />
	<meta property="og:image:secure_url" content={RADIO_OG_IMAGE} />
	<meta property="og:image:width" content="512" />
	<meta property="og:image:height" content="512" />
	<meta property="og:image:alt" content="{APP_NAME} radio" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={RADIO_OG_IMAGE} />
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<main class="radio-page">
	<div class="tuner">
	<section class="station">
		{#if radio.loading && !radio.state}
			<div class="status">tuning...</div>
		{:else if radio.error}
			<div class="status error">{radio.error}</div>
		{:else if radio.current}
			<div class="radio-player" {@attach horizontalSwipe((dir) => flip(dir === 'left' ? 'next' : 'prev'))}>
				<div class="station-title">
					<span class="live">live radio</span>
					<span class="radio-mark" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="2" />
							<path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
						</svg>
					</span>
					<span class="title-sep" aria-hidden="true"></span>
					<span class="credit">inspired by <a href="https://radio.wisp.place" target="_blank" rel="noopener">radio.wisp.place</a></span>
					<details class="integration">
						<summary>integration</summary>
						<div class="integration-panel">
							<p>poll <code>{endpoint}</code> for the shared station state.</p>
							<p>play <code>current.stream_url</code>, seek to <code>progress_seconds</code>.</p>
							<p>refresh when <code>current_ends_at</code> passes, or poll every 30s.</p>
							<p>embedding this page? add <code>?autoplay=1</code> to start playback automatically.</p>
							<p>or use the compact widget: <code>/embed/radio</code> takes <code>?station=</code> and <code>?autoplay=1</code> too.</p>
						</div>
					</details>
				</div>
				<TunerDial
					stations={radio.stations}
					{activeSlug}
					onSelect={tuneToStation}
				/>
				<div class="now-block" class:tuning={radio.switching}>
				<div class="art-stage">
					{#if radio.current.artwork_url}
						<img class="art-bg" src={radio.current.artwork_url} alt="" aria-hidden="true" />
					{/if}
					<SensitiveImage src={radio.current.artwork_url} tooltipPosition="center">
						<a class="art-link" href={`/track/${radio.current.id}`} aria-label={`view ${radio.current.title}`}>
							{#if radio.current.artwork_url}
								<img src={radio.current.artwork_url} alt="" class="art" />
							{:else}
								<div class="art fallback"></div>
							{/if}
						</a>
					</SensitiveImage>
				</div>
				<div class="now-meta">
					<p class="label">{radio.active ? 'on air' : "what's on"}</p>
					<h2>
						<a href={`/track/${radio.current.id}`}>{radio.current.title}</a>
					</h2>
					<a class="artist" href={`/u/${radio.current.artist_handle}`}>{radio.current.artist}</a>
				</div>
				</div>
				<div class="controls">
					{#if radio.active}
						<button class="tune-btn stop" onclick={() => radio.stop()} aria-label="stop listening to radio">stop</button>
					{:else}
						<button class="tune-btn" onclick={() => radio.tuneIn()} aria-label="tune in to radio">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<polygon points="6 4 20 12 6 20 6 4"></polygon>
							</svg>
							tune in
						</button>
					{/if}
					{#if auth.isAuthenticated}
						{#key radio.current.id}
							<LikeButton trackId={radio.current.id} trackTitle={radio.current.title} initialLiked={radio.current.liked} />
						{/key}
					{/if}
				</div>
				<div class="progress-wrap">
					<div class="progress" aria-label="track progress">
						<div class="progress-fill" style={`width: ${progressPercent}%`}></div>
					</div>
					<div class="progress-times">
						<span>{formatTime(radio.positionSeconds)}</span>
						<span>{formatTime(radio.current.duration)}</span>
					</div>
				</div>
			</div>
		{:else}
			<div class="status">no tracks in rotation yet</div>
		{/if}
	</section>

	{#if radio.state}
		<section class="station-board" aria-label="station">
			<div class="rotation-card">
				<div class="rotation-artworks" aria-label="tracks in rotation">
					{#each radio.state.rotation.slice(0, 10) as track (track.id)}
						<a
							class="rotation-artwork"
							href={`/track/${track.id}`}
							aria-label={`view ${track.title} by ${track.artist}`}
							title={`${track.title} by ${track.artist}`}
						>
							<SensitiveImage src={track.thumbnail_url ?? track.artwork_url} compact>
								{#if track.thumbnail_url || track.artwork_url}
									<img src={track.thumbnail_url ?? track.artwork_url ?? ''} alt="" />
								{:else}
									<div class="rotation-fallback"></div>
								{/if}
							</SensitiveImage>
							<span class="rotation-tooltip" aria-hidden="true">
								<strong>{track.title}</strong>
								<span>{track.artist}</span>
							</span>
						</a>
					{/each}
				</div>
			</div>
		</section>
	{/if}
	</div>
</main>

<style>
	.radio-page {
		position: relative;
		max-width: 980px;
		/* the global header has a 2rem margin-bottom; cancel most of it so the tuner
		   sits just under the header (a small breathing gap, not a dead band) */
		margin: -1.25rem auto 0;
		height: calc(100vh - var(--header-height, 0px) - var(--player-height, 0px) - 2rem - env(safe-area-inset-bottom, 0px));
		padding: 0 1rem 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* the tuner (pills + artwork + now-playing + controls + deck) grows to fill
	   all space above the footer and centers itself as one block. centering a
	   single group keeps the spacing balanced whether or not the docked player is
	   eating height — no lopsided top gap, no giant gaps between pieces. */
	.tuner {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		/* anchor to the top: centering left a dead band between the header and
		   "live radio". with flex-start the content starts right under the header
		   and any slack falls below (un-cramping the bottom), never above. */
		justify-content: flex-start;
		gap: clamp(0.9rem, 3vh, 2rem);
	}

	@supports (height: 100dvh) {
		.radio-page {
			height: calc(100dvh - var(--header-height, 0px) - var(--player-height, 0px) - 2rem - env(safe-area-inset-bottom, 0px));
		}
	}

	.integration {
		position: relative;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.integration summary {
		cursor: pointer;
		color: var(--text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
		list-style: none;
	}

	.integration summary::-webkit-details-marker {
		display: none;
	}

	.integration summary:hover {
		color: var(--text-primary);
	}

	.integration[open] summary {
		color: var(--text-primary);
	}

	/* anchored popover: opens below the summary, right-aligned so it grows leftward
	   and never runs off the right edge on narrow screens */
	.integration-panel {
		position: absolute;
		top: calc(100% + 0.6rem);
		right: 0;
		z-index: 30;
		width: min(86vw, 30rem);
		padding: 0.9rem 1.1rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
		-webkit-backdrop-filter: blur(16px);
		backdrop-filter: blur(16px);
		box-shadow: 0 0.75rem 2.25rem rgba(0, 0, 0, 0.4);
		text-align: left;
		text-transform: none;
	}

	.integration-panel p {
		margin: 0.4rem 0;
		line-height: 1.55;
		color: var(--text-secondary);
	}

	.integration-panel p:first-child {
		margin-top: 0;
	}

	.integration-panel p:last-child {
		margin-bottom: 0;
	}

	code {
		font-size: 0.85em;
		color: var(--text-primary);
		word-break: break-all;
	}

	.station {
		flex: 1 1 auto;
		min-height: 0;
		/* fixed-width column so the dial + controls never resize with the
		   (height-driven) artwork — the artwork is capped to this width too */
		width: min(100%, 30rem);
		align-self: center;
		display: flex;
		flex-direction: column;
		padding-top: 0;
	}

	.station-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.35rem 0.7rem;
		margin: 0;
		color: var(--text-secondary);
		line-height: 1;
		text-transform: lowercase;
	}

	.station-title .live {
		font-size: var(--text-lg);
	}

	.station-title .credit,
	.station-title .integration {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	/* thin divider between the title and the meta links */
	.title-sep {
		width: 1px;
		height: 0.9rem;
		background: var(--border-default);
	}

	/* the swappable station content — artwork + title — fades while tuning */
	.now-block {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(0.5rem, 1.35vh, 0.85rem);
		width: 100%;
		transition:
			opacity 0.22s ease,
			filter 0.22s ease;
	}

	.now-block.tuning {
		opacity: 0.35;
		filter: blur(2px);
	}

	@media (prefers-reduced-motion: reduce) {
		.now-block {
			transition: none;
		}

		.now-block.tuning {
			opacity: 0.6;
			filter: none;
		}
	}

	.label {
		margin: 0;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		text-transform: uppercase;
	}

	.label {
		margin-bottom: 0.35rem;
	}

	.radio-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		color: var(--text-tertiary);
	}

	.radio-mark svg {
		width: 100%;
		height: 100%;
	}

	.radio-player {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(0.5rem, 1.35vh, 0.85rem);
		text-align: center;
	}

	/* the artwork "stage" fills the leftover space; a blurred copy of the cover is
	   the ambient backdrop so wide/tall leftovers look intentional instead of
	   cropping the square cover into a weird slice */
	.art-stage {
		flex: 1 1 auto;
		min-height: clamp(7rem, 22vh, 18rem);
		width: 100%;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-radius: var(--radius-md);
	}

	.art-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: blur(64px) saturate(1.4);
		opacity: 0.16;
		transform: scale(1.4);
		/* soft radial falloff so it reads as a faint ambient glow behind the cover,
		   not a hard-edged blurred strip */
		-webkit-mask-image: radial-gradient(closest-side, #000 28%, transparent 72%);
		mask-image: radial-gradient(closest-side, #000 28%, transparent 72%);
		z-index: 0;
		pointer-events: none;
	}

	/* foreground cover: a contained square (never cropped to a slice) */
	.art-link {
		position: relative;
		z-index: 1;
		flex: 0 0 auto;
		display: block;
		height: 100%;
		width: auto;
		max-width: 100%;
		aspect-ratio: 1 / 1;
		text-decoration: none;
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(0.4rem, 1.2vh, 0.7rem);
	}

	.art {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: var(--radius-md);
		box-shadow: 0 0.75rem 2.5rem rgba(0, 0, 0, 0.34);
		transition:
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	.art-link:hover .art {
		box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.42);
		transform: translateY(-1px);
	}

	.art.fallback {
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
			var(--bg-secondary);
	}

	.now-meta {
		width: min(100%, 48rem);
		min-width: 0;
	}

	.now-meta h2 {
		margin: 0;
		font-size: clamp(1.5rem, 4.6vw, 2.65rem);
		line-height: 1.1;
		/* long titles (e.g. DJ-set names with dates) must not blow up the
		   fixed-height layout: wrap hard, then clamp to two lines with an ellipsis */
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.now-meta h2 a {
		color: inherit;
		text-decoration: none;
	}

	.now-meta h2 a:hover {
		color: var(--text-primary);
		text-decoration: underline;
		text-decoration-thickness: 0.06em;
		text-underline-offset: 0.08em;
	}

	.artist {
		display: block;
		max-width: 100%;
		margin-top: 0.35rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.artist:hover {
		color: var(--text-primary);
	}

	.tune-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 8.5rem;
		padding: 0.7rem 1.4rem;
		border: none;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--bg-primary);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tune-btn:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.tune-btn.stop {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
	}

	.tune-btn.stop:hover {
		background: transparent;
		border-color: var(--text-secondary);
		color: var(--text-primary);
		transform: none;
	}

	.progress-wrap {
		width: min(100%, 54rem);
		margin-top: 0.1rem;
	}

	.progress {
		margin: 0;
		height: 4px;
		border-radius: 999px;
		background: var(--bg-secondary);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.25s linear;
	}

	.progress-times {
		display: flex;
		justify-content: space-between;
		margin-top: 0.35rem;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	.status {
		padding: 3rem 0;
		color: var(--text-secondary);
	}

	.status.error {
		color: var(--error);
	}

	.station-board {
		margin-top: 0;
	}

	.rotation-card {
		min-width: 0;
		text-align: center;
	}

	.rotation-artworks {
		display: flex;
		align-items: center;
		justify-content: center;
		width: min(100%, 34rem);
		margin: 0 auto;
		padding: 0.45rem 0.85rem;
		overflow: visible;
	}

	.rotation-artwork {
		position: relative;
		display: block;
		flex: 0 0 auto;
		width: 3.35rem;
		height: 3.35rem;
		margin: 0 -0.28rem;
		border-radius: var(--radius-sm);
		color: inherit;
		text-decoration: none;
		transform: rotate(var(--tilt, 0deg)) translateY(var(--lift, 0));
		transition:
			transform 0.16s ease,
			z-index 0.16s ease;
		z-index: var(--z, 1);
		-webkit-tap-highlight-color: transparent;
	}

	.rotation-artwork:nth-child(1) {
		--tilt: -5deg;
		--lift: 0.25rem;
		--z: 1;
	}

	.rotation-artwork:nth-child(2) {
		--tilt: 3deg;
		--lift: -0.15rem;
		--z: 2;
	}

	.rotation-artwork:nth-child(3) {
		--tilt: -2deg;
		--lift: 0.1rem;
		--z: 3;
	}

	.rotation-artwork:nth-child(4) {
		--tilt: 4deg;
		--lift: -0.25rem;
		--z: 4;
	}

	.rotation-artwork:nth-child(5) {
		--tilt: -4deg;
		--lift: 0.05rem;
		--z: 5;
	}

	.rotation-artwork:nth-child(6) {
		--tilt: 2deg;
		--lift: -0.1rem;
		--z: 6;
	}

	.rotation-artwork:nth-child(7) {
		--tilt: -3deg;
		--lift: 0.22rem;
		--z: 7;
	}

	.rotation-artwork:nth-child(8) {
		--tilt: 5deg;
		--lift: -0.18rem;
		--z: 8;
	}

	.rotation-artwork:nth-child(9) {
		--tilt: -1deg;
		--lift: 0.08rem;
		--z: 9;
	}

	.rotation-artwork:nth-child(10) {
		--tilt: 3deg;
		--lift: -0.05rem;
		--z: 10;
	}

	.rotation-artwork img,
	.rotation-fallback {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border: 1px solid var(--border-default);
		border-radius: inherit;
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
			var(--bg-secondary);
		box-shadow:
			0 0 0 2px var(--bg-primary),
			0 0.45rem 1.2rem rgba(0, 0, 0, 0.24);
		transition:
			border-color 0.16s ease,
			box-shadow 0.16s ease,
			filter 0.16s ease;
	}

	.rotation-artwork:hover,
	.rotation-artwork:focus-visible {
		transform: rotate(0deg) translateY(-0.45rem) scale(1.12);
		z-index: 20;
		outline: none;
	}

	.rotation-artwork:hover img,
	.rotation-artwork:hover .rotation-fallback,
	.rotation-artwork:focus-visible img,
	.rotation-artwork:focus-visible .rotation-fallback {
		border-color: var(--text-secondary);
		box-shadow:
			0 0 0 2px var(--bg-primary),
			0 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent),
			0 0.8rem 1.8rem rgba(0, 0, 0, 0.34);
		filter: saturate(1.08);
	}

	.rotation-artwork:active {
		transform: rotate(0deg) translateY(-0.2rem) scale(1.04);
	}

	.rotation-tooltip {
		position: absolute;
		left: 50%;
		bottom: calc(100% + 0.6rem);
		width: max-content;
		max-width: min(16rem, 72vw);
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		background: var(--bg-secondary);
		color: var(--text-secondary);
		box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.28);
		font-size: var(--text-xs);
		line-height: 1.25;
		text-align: left;
		opacity: 0;
		pointer-events: none;
		transform: translate(-50%, 0.35rem);
		transition:
			opacity 0.14s ease,
			transform 0.14s ease;
	}

	.rotation-tooltip strong,
	.rotation-tooltip span {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rotation-tooltip strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	.rotation-tooltip span {
		margin-top: 0.15rem;
		color: var(--text-tertiary);
	}

	.rotation-artwork:hover .rotation-tooltip,
	.rotation-artwork:focus-visible .rotation-tooltip {
		opacity: 1;
		transform: translate(-50%, 0);
	}

	.credit {
		margin: 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}

	.credit a {
		color: var(--text-secondary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.credit a:hover {
		color: var(--text-primary);
	}

	@media (max-width: 720px) {
		.radio-page {
			height: calc(100vh - var(--header-height, 0px) - var(--player-height, 0px) - 1rem - env(safe-area-inset-bottom, 0px));
			padding-top: 0;
		}

		@supports (height: 100dvh) {
			.radio-page {
				height: calc(100dvh - var(--header-height, 0px) - var(--player-height, 0px) - 1rem - env(safe-area-inset-bottom, 0px));
			}
		}
	}

	@media (max-width: 520px) {
		/* fit the whole tuner between "live radio" and the footer without scroll */
		.tuner {
			gap: 0.9rem;
		}

		.radio-player {
			gap: 0.4rem;
		}

		.now-block {
			gap: 0.4rem;
		}

		.station-title {
			font-size: var(--text-base);
		}

		.now-meta h2 {
			font-size: 1.35rem;
		}

		/* hug the label, not the screen — the stop button was eating the layout */
		.tune-btn {
			width: auto;
			min-width: 0;
			padding: 0.45rem 1.2rem;
			font-size: var(--text-sm);
		}

		.progress-wrap {
			margin-top: 0;
		}

		.station-board {
			margin-top: 0;
		}

		.rotation-artworks {
			width: 100%;
			padding-block: 0.25rem;
			padding-inline: 0.25rem;
		}

		.rotation-artwork {
			width: 2.6rem;
			height: 2.6rem;
			margin-inline: -0.22rem;
		}
	}

	/* short viewports (landscape phones, small windows) — width breakpoints miss
	   these, so shrink by HEIGHT; scroll is the fallback below the smallest case */
	@media (max-height: 740px) {
		.tuner { gap: 0.6rem; }
		.radio-player { gap: 0.4rem; }
		.now-block { gap: 0.35rem; }
		.now-meta h2 { font-size: clamp(1.35rem, 4.2vh, 2rem); }
		.art-stage { min-height: clamp(5rem, 15vh, 11rem); }
	}

	@media (max-height: 560px) {
		.now-meta h2 { font-size: 1.2rem; }
		.art-stage { min-height: 4.5rem; }
		/* no room for the deck on a very short screen */
		.station-board { display: none; }
	}
</style>
