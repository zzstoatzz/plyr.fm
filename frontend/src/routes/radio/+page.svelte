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
		<div class="station-copy">
			<div class="station-kicker">
				<p class="eyebrow">live station</p>
				<span class="radio-mark" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="2" />
						<path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
					</svg>
				</span>
			</div>
			<h1>radio</h1>
			<p class="subtitle">plyr.fm, on air</p>
		</div>

		{#if radio.loading && !radio.state}
			<div class="status">tuning...</div>
		{:else if radio.error}
			<div class="status error">{radio.error}</div>
		{:else if radio.current}
			<div class="now-card">
				{#if radio.current.artwork_url}
					<img src={radio.current.artwork_url} alt="" class="art" />
				{:else}
					<div class="art fallback"></div>
				{/if}
				<div class="now-meta">
					<p class="label">{radio.active ? 'on air' : "what's on"}</p>
					<h2>{radio.current.title}</h2>
					<a class="artist" href={`/u/${radio.current.artist_handle}`}>@{radio.current.artist_handle}</a>
				</div>
				{#if radio.active}
					<button class="tune-btn stop" onclick={() => radio.stop()}>stop</button>
				{:else}
					<button class="tune-btn" onclick={() => radio.tuneIn()}>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<polygon points="6 4 20 12 6 20 6 4"></polygon>
						</svg>
						tune in
					</button>
				{/if}
			</div>
			<div class="progress" aria-label="track progress">
				<div class="progress-fill" style={`width: ${progressPercent}%`}></div>
			</div>
			<div class="progress-times">
				<span>{formatTime(radio.positionSeconds)}</span>
				<span>{formatTime(radio.current.duration)}</span>
			</div>
		{:else}
			<div class="status">no tracks in rotation yet</div>
		{/if}
	</section>

	{#if radio.state && radio.state.up_next.length > 0}
		<section class="queue-strip" aria-label="up next">
			<div class="section-heading">
				<h2>up next</h2>
				<span>{radio.state.rotation.length} in rotation</span>
			</div>
			<div class="up-next">
				{#each radio.state.up_next as track (track.id)}
					<a class="next-track" href={`/track/${track.id}`}>
						{#if track.thumbnail_url || track.artwork_url}
							<img src={track.thumbnail_url ?? track.artwork_url ?? ''} alt="" />
						{:else}
							<div class="thumb-fallback"></div>
						{/if}
						<div>
							<strong>{track.title}</strong>
							<span>@{track.artist_handle}</span>
						</div>
					</a>
				{/each}
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
		padding: 0 1rem calc(var(--player-height, 0px) + 3rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.radio-footer {
		margin-top: 2.5rem;
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
		padding-top: 3.5rem;
	}

	.station-copy {
		margin-bottom: 2rem;
	}

	.station-kicker {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 0.35rem;
	}

	.eyebrow,
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

	h1 {
		margin: 0;
		font-size: clamp(3rem, 11vw, 5.75rem);
		line-height: 0.9;
	}

	.subtitle {
		max-width: 38rem;
		margin: 1rem 0 0;
		color: var(--text-secondary);
		font-size: var(--text-lg);
		line-height: 1.45;
	}

	.now-card {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.art {
		width: 8rem;
		height: 8rem;
		object-fit: cover;
		border: 1px solid var(--border-default);
		flex-shrink: 0;
	}

	.art.fallback,
	.thumb-fallback {
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
			var(--bg-secondary);
	}

	.now-meta {
		flex: 1;
		min-width: 12rem;
	}

	.now-meta h2 {
		margin: 0;
		font-size: clamp(1.75rem, 5vw, 3rem);
		line-height: 1;
		overflow-wrap: anywhere;
	}

	.artist {
		display: inline-block;
		margin-top: 0.6rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-lg);
	}

	.artist:hover,
	.next-track:hover strong {
		color: var(--text-primary);
	}

	.tune-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
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

	.progress {
		margin: 1.25rem 0 0;
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
		margin-top: 0.5rem;
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

	.queue-strip {
		margin-top: 3rem;
	}

	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	.section-heading h2 {
		margin: 0;
		font-size: var(--text-lg);
	}

	.section-heading span {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}

	.up-next {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		padding-bottom: 0.35rem;
	}

	.next-track {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-height: 4rem;
		color: var(--text-secondary);
		text-decoration: none;
		flex: 0 0 clamp(13rem, 28vw, 17rem);
		scroll-snap-align: start;
	}

	.next-track img,
	.thumb-fallback {
		width: 3.25rem;
		height: 3.25rem;
		object-fit: cover;
		border: 1px solid var(--border-default);
	}

	.next-track strong,
	.next-track span {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.next-track strong {
		color: var(--text-primary);
		font-size: var(--text-sm);
	}

	.next-track span {
		margin-top: 0.15rem;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
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
			padding-top: 0;
		}

		.station {
			padding-top: 2.25rem;
		}
	}

	@media (max-width: 520px) {
		.now-card {
			gap: 1rem;
		}

		.art {
			width: 5.5rem;
			height: 5.5rem;
		}

		/* let the meta shrink next to the art; the button wraps full-width below */
		.now-meta {
			min-width: 0;
			flex-basis: calc(100% - 6.5rem);
		}

		.tune-btn {
			width: 100%;
			justify-content: center;
		}

		.next-track {
			flex-basis: min(17rem, 74vw);
		}
	}
</style>
