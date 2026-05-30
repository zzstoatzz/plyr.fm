<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { radio } from '$lib/radio.svelte';

	const endpoint = `${API_URL}/radio/state`;

	// link preview — a stable station identity, not a per-moment "now playing"
	// (the on-air track changes constantly and scrapers cache the snapshot).
	const RADIO_DESCRIPTION =
		'a live, always-on stream of audio from across plyr.fm — tune in and let it play.';
	const RADIO_OG_IMAGE = `${APP_CANONICAL_URL}/icons/icon-512.png`;

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
		// populate "what's on" for display without starting playback
		if (!radio.state) radio.loadState();
	});
</script>

<svelte:head>
	<title>radio • {APP_NAME}</title>
	<meta name="description" content={RADIO_DESCRIPTION} />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="radio · {APP_NAME}" />
	<meta property="og:description" content={RADIO_DESCRIPTION} />
	<meta property="og:url" content={`${APP_CANONICAL_URL}/radio`} />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="og:image" content={RADIO_OG_IMAGE} />
	<meta property="og:image:secure_url" content={RADIO_OG_IMAGE} />
	<meta property="og:image:width" content="512" />
	<meta property="og:image:height" content="512" />
	<meta property="og:image:alt" content="{APP_NAME} radio" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="radio · {APP_NAME}" />
	<meta name="twitter:description" content={RADIO_DESCRIPTION} />
	<meta name="twitter:image" content={RADIO_OG_IMAGE} />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<main class="radio-page">
	<section class="station">
		{#if radio.loading && !radio.state}
			<div class="status">tuning...</div>
		{:else if radio.error}
			<div class="status error">{radio.error}</div>
		{:else if radio.current}
			<div class="radio-player">
				<div class="station-title">
					<span>live radio</span>
					<span class="radio-mark" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="2" />
							<path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
						</svg>
					</span>
					{#if radio.active}
						<span class="source-state">listening here</span>
					{/if}
				</div>
				<a class="art-link" href={`/track/${radio.current.id}`} aria-label={`view ${radio.current.title}`}>
					{#if radio.current.artwork_url}
						<img src={radio.current.artwork_url} alt="" class="art" />
					{:else}
						<div class="art fallback"></div>
					{/if}
				</a>
				<div class="now-meta">
					<p class="label">{radio.active ? 'on air' : "what's on"}</p>
					<h2>
						<a href={`/track/${radio.current.id}`}>{radio.current.title}</a>
					</h2>
					<a class="artist" href={`/u/${radio.current.artist_handle}`}>{radio.current.artist}</a>
				</div>
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
							{#if track.thumbnail_url || track.artwork_url}
								<img src={track.thumbnail_url ?? track.artwork_url ?? ''} alt="" />
							{:else}
								<div class="rotation-fallback"></div>
							{/if}
							<span class="rotation-tooltip" aria-hidden="true">
								<strong>{track.title}</strong>
								<span>{track.artist}</span>
							</span>
						</a>
					{/each}
				</div>
				<p>from across plyr.fm</p>
			</div>
		</section>
	{/if}

	<footer class="radio-footer">
		<p class="credit">
			inspired by <a href="https://radio.wisp.place" target="_blank" rel="noopener">radio.wisp.place</a>
		</p>
		<details class="integration">
			<summary>integration</summary>
			<p>poll <code>{endpoint}</code> for the shared station state.</p>
			<p>play <code>current.stream_url</code>, seek to <code>progress_seconds</code>.</p>
			<p>refresh when <code>current_ends_at</code> passes, or poll every 30s.</p>
		</details>
	</footer>
</main>

<style>
	.radio-page {
		position: relative;
		max-width: 980px;
		margin: 0 auto;
		height: calc(100vh - var(--header-height, 0px) - var(--player-height, 0px) - 2rem);
		padding: 0 1rem 0.75rem;
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 0.65rem;
		overflow: hidden;
	}

	@supports (height: 100dvh) {
		.radio-page {
			height: calc(100dvh - var(--header-height, 0px) - var(--player-height, 0px) - 2rem);
		}
	}

	.radio-footer {
		margin-top: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1.5rem;
	}

	.integration {
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
		margin-bottom: 0.5rem;
	}

	.integration p {
		margin: 0.35rem 0;
		max-width: 42rem;
		line-height: 1.5;
	}

	code {
		font-size: 0.85em;
		color: var(--text-primary);
	}

	.station {
		min-height: 0;
		padding-top: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.station-title {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-lg);
		line-height: 1;
		text-transform: lowercase;
	}

	.source-state {
		margin-left: 0.15rem;
		padding-left: 0.7rem;
		border-left: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		font-size: var(--text-sm);
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
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		text-align: center;
	}

	.art-link {
		display: block;
		text-decoration: none;
		border-radius: var(--radius-md);
	}

	.art {
		display: block;
		width: clamp(11rem, min(30vw, 34vh), 17rem);
		height: clamp(11rem, min(30vw, 34vh), 17rem);
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
		font-size: clamp(1.75rem, 4.6vw, 2.65rem);
		line-height: 1.05;
		overflow-wrap: normal;
		text-wrap: balance;
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
		display: inline-block;
		margin-top: 0.35rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-base);
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
		margin-top: 1rem;
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

	.rotation-card p {
		margin: 0.25rem 0 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
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

	@media (min-width: 721px) {
		.radio-footer {
			justify-content: center;
		}
	}

	@media (max-width: 720px) {
		.radio-page {
			height: calc(100vh - var(--header-height, 0px) - var(--player-height, 0px) - 1rem);
			padding-top: 0;
			gap: 0.5rem;
		}

		@supports (height: 100dvh) {
			.radio-page {
				height: calc(100dvh - var(--header-height, 0px) - var(--player-height, 0px) - 1rem);
			}
		}
	}

	@media (max-width: 520px) {
		.radio-player {
			gap: 0.55rem;
		}

		.art {
			width: min(58vw, 12rem);
			height: min(58vw, 12rem);
		}

		.tune-btn {
			width: min(100%, 16rem);
			justify-content: center;
		}

		.station-board {
			margin-top: 0.75rem;
		}

		.rotation-artworks {
			width: 100%;
			padding-inline: 0.25rem;
		}

		.rotation-artwork {
			width: 2.85rem;
			height: 2.85rem;
			margin-inline: -0.22rem;
		}
	}
</style>
