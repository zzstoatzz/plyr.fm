<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { radio } from '$lib/radio.svelte';

	let helpOpen = $state(false);
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

	onMount(() => {
		auth.initialize();
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
	<div class="help-corner">
		<button
			class="help-button"
			type="button"
			aria-label="radio integration details"
			aria-expanded={helpOpen}
			onclick={() => (helpOpen = !helpOpen)}
		>
			?
		</button>
		{#if helpOpen}
			<div class="help-panel" role="tooltip">
				<strong>integration</strong>
				<p>poll <code>{endpoint}</code> for the shared station state.</p>
				<p>play <code>current.stream_url</code> and seek to <code>progress_seconds</code>.</p>
				<p>refresh when <code>current_ends_at</code> passes, or poll every 30s.</p>
			</div>
		{/if}
	</div>

	<section class="station">
		<div class="station-copy">
			<p class="eyebrow">live station</p>
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
			{#if radio.active}
				<p class="now-hint">playing in your player — keep browsing, it follows you.</p>
			{/if}
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
</main>

<style>
	.radio-page {
		position: relative;
		max-width: 980px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 3rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.help-corner {
		position: fixed;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		right: 1rem;
		z-index: 20;
	}

	.help-button {
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 1px solid var(--border-default);
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-weight: 700;
		cursor: help;
	}

	.help-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		width: min(21rem, calc(100vw - 2rem));
		padding: 0.85rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		background: var(--bg-primary);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.help-panel strong {
		display: block;
		margin-bottom: 0.35rem;
		color: var(--text-primary);
	}

	.help-panel p {
		margin: 0.35rem 0;
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

	.eyebrow,
	.label {
		margin: 0 0 0.35rem;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(3rem, 13vw, 7rem);
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

	.now-hint {
		margin: 1rem 0 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
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
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
	}

	.next-track {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		min-height: 4rem;
		color: var(--text-secondary);
		text-decoration: none;
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

	@media (max-width: 720px) {
		.radio-page {
			padding-top: 0;
		}

		.station {
			padding-top: 2.25rem;
		}
	}
</style>
