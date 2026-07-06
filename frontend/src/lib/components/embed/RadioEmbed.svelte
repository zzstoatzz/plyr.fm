<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { API_URL } from '$lib/config';
	import TunerDial from '$lib/components/radio/TunerDial.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import type { RadioState, RadioStation, RadioTrack } from '$lib/radio.svelte';

	// standalone embed player: this is its own iframe context (not the main app),
	// so it owns a local <audio> and its own station polling.
	let audioElement = $state<HTMLAudioElement | null>(null);
	let radioState = $state<RadioState | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let playing = $state(false);
	/** listener intent: true while the user wants to stay tuned in. `playing`
	 * tracks the raw element state, which flips false at every track boundary
	 * (the browser fires pause before ended) — resume decisions key off this
	 * flag so auto-advance survives the boundary. */
	let tunedIn = $state(false);
	let stations = $state<RadioStation[]>([]);
	/** selected station slug; null defers to the server default. seeded from
	 * the iframe url's ?station= so embedders can pin a station. */
	let station = $state<string | null>(null);
	let switching = $state(false);
	let pollTimer: number | null = null;

	let current: RadioTrack | null = $derived(radioState?.current ?? null);
	let activeSlug = $derived(radioState?.station_slug ?? station);

	function stateProgress(fetched: RadioState): number {
		const generatedAt = Date.parse(fetched.generated_at);
		const drift = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 1000) : 0;
		return Math.min(fetched.current?.duration ?? 0, fetched.progress_seconds + drift);
	}

	function syncAudio(fetched: RadioState) {
		const el = audioElement;
		if (!el || !fetched.current) return;
		const target = stateProgress(fetched);
		const changed = el.src !== fetched.current.stream_url;
		if (changed) {
			el.src = fetched.current.stream_url;
			el.load();
		}
		const seek = () => {
			if (!el || !fetched.current) return;
			if (Number.isFinite(target)) el.currentTime = Math.min(target, fetched.current.duration);
			if (tunedIn) el.play().catch(() => (playing = tunedIn = false));
		};
		if (el.readyState >= 1 && !changed) {
			if (Math.abs(el.currentTime - target) > 5) seek();
		} else {
			el.onloadedmetadata = seek;
		}
	}

	async function loadStations() {
		try {
			const res = await fetch(`${API_URL}/radio/stations`);
			if (!res.ok) return;
			stations = (await res.json()).stations;
		} catch (e) {
			console.error('radio embed: failed to load stations', e);
		}
	}

	async function loadState(sync = false): Promise<void> {
		try {
			const query = station ? `?station=${encodeURIComponent(station)}` : '';
			const res = await fetch(`${API_URL}/radio/state${query}`);
			if (res.status === 404 && station) {
				// unknown station slug (bad embed param or a renamed station) —
				// fall back to the server default rather than going "off air"
				station = null;
				return loadState(sync);
			}
			if (!res.ok) throw new Error(`radio ${res.status}`);
			radioState = await res.json();
			error = null;
			if (sync && radioState) syncAudio(radioState);
		} catch (e) {
			console.error('radio embed: failed to load state', e);
			error = 'radio is off air right now';
		} finally {
			loading = false;
		}
	}

	async function selectStation(slug: string) {
		if (slug === activeSlug) return;
		station = slug;
		switching = true;
		try {
			// sync so a tuned-in listener follows the audio across the flip;
			// while paused this just preloads the new station's track
			await loadState(true);
		} finally {
			switching = false;
		}
	}

	function toggle() {
		const el = audioElement;
		if (!el || !current) return;
		if (playing) {
			tunedIn = false;
			el.pause();
		} else {
			// user gesture — safe to start audio
			tunedIn = true;
			syncAudio(radioState!);
			el.play().then(() => (playing = true)).catch(() => (playing = tunedIn = false));
		}
	}

	/** at a track boundary the server rotation may not have flipped yet — retry
	 * briefly so the embed doesn't sit silent until the next 30s poll. */
	async function advance(endedSrc: string): Promise<void> {
		for (let attempt = 0; attempt < 5; attempt++) {
			await loadState(true);
			if (!tunedIn || (current && current.stream_url !== endedSrc)) return;
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}

	onMount(() => {
		const params = $page.url.searchParams;
		station = params.get('station');
		const autoplay = params.get('autoplay') === '1';
		loadStations();
		// ?autoplay=1 tunes in once the on-air track arrives (same convention as
		// the other embeds). without a prior gesture, autoplay policy blocks the
		// play() and toggle's catch leaves the widget in its normal paused state.
		loadState(false).then(() => {
			if (autoplay && !playing) toggle();
		});
		pollTimer = window.setInterval(() => loadState(tunedIn), 30000);
		return () => {
			if (pollTimer) window.clearInterval(pollTimer);
		};
	});
</script>

<audio
	bind:this={audioElement}
	preload="metadata"
	onended={(e) => advance(e.currentTarget.src)}
	onplay={() => (playing = true)}
	onpause={(e) => {
		playing = false;
		// pause fired by reaching the end of a track keeps the listener tuned
		// in; only an explicit pause (media keys, OS controls) drops intent
		if (!e.currentTarget.ended) tunedIn = false;
	}}
></audio>

<div class="radio-embed">
	<a class="brand" href={`https://plyr.fm/radio${activeSlug ? `/${activeSlug}` : ''}`} target="_blank" rel="noopener">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="2"></circle>
			<path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"></path>
		</svg>
		<span>plyr.fm radio</span>
	</a>

	<div class="dial-row">
		<TunerDial {stations} {activeSlug} onSelect={selectStation} />
	</div>

	{#if loading && !radioState}
		<div class="status">tuning…</div>
	{:else if error}
		<div class="status error">{error}</div>
	{:else if current}
		<div class="now" class:tuning={switching}>
			{#if current.artwork_url}
				<SensitiveImage src={current.artwork_url} compact respectPreference={false}>
					<img class="art" src={current.artwork_url} alt="" />
				</SensitiveImage>
			{:else}
				<div class="art fallback"></div>
			{/if}
			<div class="meta">
				<span class="label">{playing ? 'on air' : "what's on"}</span>
				<span class="title">{current.title}</span>
				<a class="artist" href={`https://plyr.fm/u/${current.artist_handle}`} target="_blank" rel="noopener">{current.artist}</a>
			</div>
			<button class="play" onclick={toggle} aria-label={playing ? 'pause radio' : 'play radio'}>
				{#if playing}
					<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>
				{:else}
					<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>
				{/if}
			</button>
		</div>
	{:else}
		<div class="status">no tracks in rotation yet</div>
	{/if}
</div>

<style>
	.radio-embed {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--bg-primary);
		color: var(--text-primary);
		font-family:
			'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--accent);
		text-decoration: none;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.brand:hover {
		text-decoration: underline;
	}

	.dial-row {
		display: flex;
		justify-content: center;
	}

	/* iframes sized for the pre-dial layout are too short for an extra row —
	   keep them uncropped and let ?station= still pin the station */
	@media (max-height: 11.5rem) {
		.dial-row {
			display: none;
		}
	}

	.status {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
	}

	.status.error {
		color: #ef4444;
	}

	.now {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 0;
		transition:
			opacity 0.22s ease,
			filter 0.22s ease;
	}

	/* the swappable station content fades while tuning, same as the radio page */
	.now.tuning {
		opacity: 0.35;
		filter: blur(2px);
	}

	@media (prefers-reduced-motion: reduce) {
		.now {
			transition: none;
		}

		.now.tuning {
			opacity: 0.6;
			filter: none;
		}
	}

	.art {
		width: 5rem;
		height: 5rem;
		border-radius: 8px;
		object-fit: cover;
		border: 1px solid var(--border-default);
		flex-shrink: 0;
	}

	.art.fallback {
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
			var(--bg-secondary);
	}

	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}

	.title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.artist {
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.artist:hover {
		color: var(--text-primary);
	}

	.play {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-full);
		border: none;
		background: var(--accent);
		color: var(--bg-primary);
		cursor: pointer;
		transition: filter 0.15s;
	}

	.play:hover {
		filter: brightness(1.1);
	}
</style>
