<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { horizontalSwipe } from '$lib/horizontal-swipe';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import { radio } from '$lib/radio.svelte';
	import TunerDial from '$lib/components/radio/TunerDial.svelte';
	import Listeners from '$lib/components/radio/Listeners.svelte';
	import ScrollingText from '$lib/components/ScrollingText.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import AddToMenu from '$lib/components/AddToMenu.svelte';
	import { IMAGE_WIDTHS, resizedImageUrl } from '$lib/utils/display-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let stationParam = $derived($page.params.station ?? null);
	let activeSlug = $derived(radio.state?.station_slug ?? radio.station ?? 'loved');
	let listening = $derived(radio.active && !player.paused);
	let title = $derived(
		data.station ? `${data.station.name} · ${APP_NAME} radio` : `${APP_NAME} radio`
	);
	let description = $derived(data.station?.description ?? 'listen together to music from plyr.fm');
	let progress = $derived(
		radio.current?.duration
			? Math.min(100, (radio.positionSeconds / radio.current.duration) * 100)
			: 0
	);
	let autoplayRequested = $derived($page.url.searchParams.get('autoplay') === '1');
	let autoTuned = false;

	$effect(() => {
		const slug = stationParam;
		untrack(() => radio.show(slug));
	});
	$effect(() => {
		if (autoplayRequested && !autoTuned && radio.hasSomethingOnAir && !radio.active) {
			autoTuned = true;
			setTimeout(() => radio.tuneIn(), 0);
		}
	});

	function selectStation(slug: string): void {
		void goto(`/radio/${slug}`, { keepFocus: true, noScroll: true });
	}
	function flip(direction: 'next' | 'prev'): void {
		const slug = radio.nextStationSlug(direction);
		if (slug) selectStation(slug);
	}
	function togglePlayback(): void {
		if (listening) player.audioElement?.pause();
		else radio.tuneIn();
	}
	function formatTime(seconds: number): string {
		const value = Math.max(0, Math.floor(seconds));
		return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, '0')}`;
	}
	async function handleLogout(): Promise<void> {
		await auth.logout();
		window.location.href = '/';
	}
	onMount(() => {
		if (!radio.stations.length) void radio.loadStations();
	});
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={`${APP_CANONICAL_URL}/icons/icon-512.png`} />
	<meta property="og:url" content={`${APP_CANONICAL_URL}/radio/${activeSlug}`} />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<main class="radio-page">
	<header class="page-heading">
		<div>
			<span class="eyebrow">plyr.fm</span>
			<h1>radio</h1>
		</div>
		<p>same station, same moment</p>
	</header>
	<div class="radio-layout">
		<section
			class="now-playing"
			aria-label="now playing"
			{@attach horizontalSwipe((dir) => flip(dir === 'left' ? 'next' : 'prev'))}
		>
			{#if radio.loading && !radio.state}
				<WaveLoading size="lg" message="tuning in..." />
			{:else if radio.error}
				<p role="alert">{radio.error}</p>
				<button class="retry" onclick={() => radio.loadState()}>try again</button>
			{:else if radio.current}
				<SensitiveImage src={radio.current.artwork_url} tooltipPosition="center">
					<a
						class="cover"
						href={`/track/${radio.current.id}`}
						aria-label={`view ${radio.current.title}`}
					>
						{#if radio.current.artwork_url}
							<img src={resizedImageUrl(radio.current.artwork_url, IMAGE_WIDTHS.hero)} alt="" />
						{:else}<span class="cover-placeholder">plyr.fm</span>{/if}
					</a>
				</SensitiveImage>
				<div class="track-heading">
					<div class="track-copy">
						<p class="eyebrow">now playing</p>
						<h2>
							<a href={`/track/${radio.current.id}`}
								><ScrollingText text={radio.current.title} trigger="always" /></a
							>
						</h2>
						<a class="artist" href={`/u/${radio.current.artist_handle}`}>{radio.current.artist}</a>
					</div>
					<button
						class="play"
						onclick={togglePlayback}
						aria-label={listening ? 'pause radio' : 'listen to radio'}
					>
						{#if listening}<svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M7 5h4v14H7zM14 5h4v14h-4z" /></svg
							>
						{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 13 8-13 8z" /></svg
							>{/if}
					</button>
				</div>
				<div
					class="progress"
					role="progressbar"
					aria-label="track progress"
					aria-valuenow={Math.round(progress)}
					aria-valuemin="0"
					aria-valuemax="100"
				>
					<span style={`width: ${progress}%`}></span>
				</div>
				<div class="time">
					<span>{formatTime(radio.positionSeconds)}</span><span
						>{formatTime(radio.current.duration)}</span
					>
				</div>
				<div class="track-actions">
					<a href={`/track/${radio.current.id}`}>view track</a>
					{#if auth.isAuthenticated}
						{#key radio.current.id}<AddToMenu
								trackId={radio.current.id}
								trackTitle={radio.current.title}
								trackUri={radio.current.atproto_record_uri ?? undefined}
								trackCid={radio.current.atproto_record_cid ?? undefined}
								initialLiked={radio.current.liked}
							/>{/key}
					{/if}
				</div>
			{:else}
				<div class="off-air">
					<span class="eyebrow">{radio.activeStation?.name ?? 'radio'}</span>
					<h2>off air</h2>
					<p>no tracks on this station right now. try another station.</p>
				</div>
			{/if}
		</section>
		<aside>
			<section class="station" aria-label="station tuner">
				<div class="section-heading">
					<h2>station</h2>
					<Listeners station={activeSlug} />
				</div>
				<div class="station-heading">
					<button aria-label="previous station" onclick={() => flip('prev')}>←</button>
					<div>
						<strong>{radio.activeStation?.name ?? activeSlug}</strong>
						<p>{radio.activeStation?.description ?? 'music from plyr.fm'}</p>
					</div>
					<button aria-label="next station" onclick={() => flip('next')}>→</button>
				</div>
				<TunerDial stations={radio.stations} {activeSlug} onSelect={selectStation} />
			</section>
			<section class="up-next" aria-label="up next">
				<div class="section-heading">
					<h2>up next</h2>
					<span>{radio.state?.up_next.length ?? 0} tracks</span>
				</div>
				<ol>
					{#each radio.state?.up_next ?? [] as track, index (`${index}:${track.id}`)}
						<li>
							<span class="number">{index + 1}</span><SensitiveImage src={track.artwork_url}
								><a href={`/track/${track.id}`} tabindex="-1" aria-hidden="true" class="queue-art"
									>{#if track.artwork_url}<img
											src={resizedImageUrl(track.artwork_url, IMAGE_WIDTHS.thumb)}
											alt=""
										/>{/if}</a
								></SensitiveImage
							>
							<div class="queued-track">
								<a href={`/track/${track.id}`}>{track.title}</a><a
									class="artist"
									href={`/u/${track.artist_handle}`}>{track.artist}</a
								>
							</div>
							<span class="duration">{formatTime(track.duration)}</span>
						</li>
					{:else}<li class="empty">nothing queued yet</li>{/each}
				</ol>
			</section>
		</aside>
	</div>
	<footer>
		inspired by <a href="https://tangled.org/okami.mom/sister-radio" target="_blank" rel="noopener"
			>Ana’s radio</a
		>
		· <a href="https://github.com/zzstoatzz/plyr.fm" target="_blank" rel="noopener">source</a>
	</footer>
</main>

<style>
	.radio-page {
		max-width: 74rem;
		margin: 0 auto;
		padding: 1.5rem 2rem calc(var(--player-height, 5rem) + 2rem);
	}
	.page-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 2rem;
		gap: 1rem;
	}
	h1 {
		font-size: var(--text-3xl);
		margin: 0.15rem 0 0;
		font-weight: 500;
	}
	.page-heading p,
	.eyebrow {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
	.eyebrow {
		margin: 0;
		letter-spacing: 0.08em;
	}
	.radio-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 3rem;
		align-items: start;
	}
	.now-playing,
	aside,
	.track-copy,
	.queued-track {
		min-width: 0;
	}
	.cover {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		max-height: 28rem;
		width: 100%;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.cover img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.cover-placeholder {
		color: var(--text-tertiary);
		font-size: var(--text-3xl);
	}
	.track-heading {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1.5rem 0 1rem;
	}
	.track-copy {
		flex: 1;
	}
	h2 {
		font-size: var(--text-2xl);
		font-weight: 500;
		margin: 0.4rem 0;
	}
	a {
		color: inherit;
		text-decoration: none;
	}
	a:hover {
		color: var(--accent);
	}
	.artist {
		display: block;
		color: var(--text-secondary);
		font-size: var(--text-base);
		margin-top: 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button {
		font-family: inherit;
		cursor: pointer;
	}
	.play {
		width: 3.4rem;
		height: 3.4rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--accent);
		background: var(--bg-primary);
		color: var(--accent);
		flex-shrink: 0;
		display: grid;
		place-items: center;
	}
	.play:hover {
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-primary));
	}
	.play svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: currentColor;
	}
	.progress {
		background: var(--bg-tertiary);
		height: 3px;
		border-radius: var(--radius-full);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.time {
		display: flex;
		justify-content: space-between;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		margin-top: 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	.track-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		border-bottom: 1px solid var(--border-default);
		padding-bottom: 0.75rem;
	}
	.section-heading h2,
	.section-heading > span {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0;
	}
	.station-heading {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin: 1rem 0;
	}
	.station-heading div {
		flex: 1;
		text-align: center;
		min-width: 0;
	}
	.station-heading strong {
		font-size: var(--text-xl);
		font-weight: 500;
	}
	.station-heading p {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0.4rem 0;
	}
	.station-heading button {
		border: 0;
		padding: 0.5rem;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-xl);
	}
	.station :global(.dial) {
		width: 100%;
	}
	.up-next {
		margin-top: 2rem;
	}
	ol {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	.number,
	.duration {
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.number {
		width: 1rem;
	}
	.queue-art {
		display: block;
		width: 2.75rem;
		height: 2.75rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.queue-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.queued-track {
		flex: 1;
	}
	.queued-track > a:first-child {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-base);
	}
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
	.off-air {
		display: grid;
		align-content: center;
		min-height: 20rem;
		padding: 2rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
	}
	.off-air p {
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.retry {
		color: var(--accent);
		background: transparent;
		border: 1px solid var(--border-default);
		padding: 0.5rem 1rem;
		border-radius: var(--radius-base);
	}
	footer {
		margin-top: 2.5rem;
		text-align: center;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
	}
	footer a {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	@media (max-width: 720px) {
		.radio-page {
			padding-inline: 1rem;
		}
		.radio-layout {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}
		.page-heading {
			margin-bottom: 1rem;
		}
		.page-heading p {
			font-size: var(--text-xs);
		}
		.cover {
			max-height: 24rem;
		}
		.up-next {
			margin-top: 1.5rem;
		}
	}
</style>
