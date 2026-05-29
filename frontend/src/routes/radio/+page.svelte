<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';

	interface RadioTrack {
		id: number;
		title: string;
		artist: string;
		artist_handle: string;
		artist_did: string;
		stream_url: string;
		file_type: string;
		duration: number;
		artwork_url: string | null;
		thumbnail_url: string | null;
		atproto_record_uri: string | null;
		created_at: string;
		tags: string[];
		like_count: number;
		play_count: number;
	}

	interface RadioState {
		station: string;
		generated_at: string;
		loop_duration_seconds: number;
		current_index: number | null;
		current_started_at: string | null;
		current_ends_at: string | null;
		progress_seconds: number;
		current: RadioTrack | null;
		up_next: RadioTrack[];
		rotation: RadioTrack[];
	}

	let radioState = $state<RadioState | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let playing = $state(false);
	let helpOpen = $state(false);
	let audioElement = $state<HTMLAudioElement | null>(null);
	let progressSeconds = $state(0);
	let volume = $state(0.72);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	let current = $derived(radioState?.current ?? null);
	let duration = $derived(current?.duration ?? 0);
	let progressPercent = $derived(duration > 0 ? Math.min(100, (progressSeconds / duration) * 100) : 0);
	let endpoint = $derived(`${API_URL}/radio/state`);

	function formatTime(seconds: number): string {
		const safe = Math.max(0, Math.floor(seconds));
		const minutes = Math.floor(safe / 60);
		const remainder = safe % 60;
		return `${minutes}:${remainder.toString().padStart(2, '0')}`;
	}

	function stateProgress(fetched: RadioState): number {
		const generatedAt = Date.parse(fetched.generated_at);
		const drift = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 1000) : 0;
		return Math.min(fetched.current?.duration ?? 0, fetched.progress_seconds + drift);
	}

	function syncAudioToState(fetched: RadioState) {
		if (!audioElement || !fetched.current) return;

		const targetProgress = stateProgress(fetched);
		const sourceChanged = audioElement.src !== fetched.current.stream_url;

		if (sourceChanged) {
			audioElement.src = fetched.current.stream_url;
			audioElement.load();
		}

		const seek = () => {
			if (!audioElement || !fetched.current) return;
			if (Number.isFinite(targetProgress)) {
				audioElement.currentTime = Math.min(targetProgress, fetched.current.duration);
				progressSeconds = audioElement.currentTime;
			}
			if (playing) audioElement.play().catch(() => (playing = false));
		};

		if (audioElement.readyState >= HTMLMediaElement.HAVE_METADATA && !sourceChanged) {
			if (Math.abs(audioElement.currentTime - targetProgress) > 5) {
				seek();
			}
		} else {
			audioElement.onloadedmetadata = seek;
		}
	}

	async function fetchRadioState(syncAudio = true) {
		try {
			const response = await fetch(endpoint);
			if (!response.ok) {
				throw new Error(`radio returned ${response.status}`);
			}
			const nextState: RadioState = await response.json();
			radioState = nextState;
			progressSeconds = stateProgress(nextState);
			error = null;
			if (syncAudio) syncAudioToState(nextState);
		} catch (e) {
			console.error('failed to load radio state:', e);
			error = 'radio is off air right now';
		} finally {
			loading = false;
		}
	}

	async function tuneIn() {
		if (!audioElement || !radioState?.current) return;
		audioElement.volume = volume;
		syncAudioToState(radioState);
		try {
			await audioElement.play();
			playing = true;
		} catch (e) {
			console.error('failed to play radio:', e);
			playing = false;
		}
	}

	function handleVolumeInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		volume = Number(input.value);
		if (audioElement) audioElement.volume = volume;
		if (!playing) tuneIn();
	}

	function handleTimeUpdate() {
		if (!audioElement) return;
		progressSeconds = audioElement.currentTime;
	}

	function handleEnded() {
		fetchRadioState(true);
	}

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	onMount(() => {
		auth.initialize();
		const savedVolume = localStorage.getItem('radio_volume');
		if (savedVolume) volume = Number(savedVolume);
		fetchRadioState(false);
		pollTimer = setInterval(() => {
			fetchRadioState(playing);
		}, 30000);

		return () => {
			if (pollTimer) clearInterval(pollTimer);
		};
	});

	$effect(() => {
		localStorage.setItem('radio_volume', volume.toString());
		if (audioElement) audioElement.volume = volume;
	});
</script>

<svelte:head>
	<title>radio • {APP_NAME}</title>
	<meta
		name="description"
		content="live public radio state from plyr.fm for listeners, games, and lightweight clients"
	/>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<audio
	bind:this={audioElement}
	preload="metadata"
	ontimeupdate={handleTimeUpdate}
	onended={handleEnded}
	onpause={() => (playing = false)}
	onplay={() => (playing = true)}
></audio>

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
			<p class="subtitle">one public plyr.fm signal for clients, games, and late-night tabs</p>
		</div>

		{#if loading}
			<div class="status">tuning...</div>
		{:else if error}
			<div class="status error">{error}</div>
		{:else if current}
			<div class="now">
				<div class="radio-face">
					<div class="speaker">
						{#if current.artwork_url}
							<img src={current.artwork_url} alt="" class="art" />
						{:else}
							<div class="art fallback"></div>
						{/if}
					</div>
					<div class="receiver">
						<div class="signal-row">
							<span class:active={playing}></span>
							<span class:active={playing}></span>
							<span class:active={playing}></span>
							<span class:active={playing}></span>
						</div>
						<div class="frequency">radio.plyr.fm</div>
						<div class="needle-track" aria-label="radio progress">
							<div class="needle" style={`left: ${progressPercent}%`}></div>
						</div>
					</div>
				</div>

				<div class="track-panel">
					<div class="track-meta">
						<p class="label">{playing ? 'on air' : 'standby'}</p>
						<h2>{current.title}</h2>
						<a class="artist" href={`/u/${current.artist_handle}`}>@{current.artist_handle}</a>
					</div>

					<div class="progress-row">
						<span>{formatTime(progressSeconds)}</span>
						<div class="progress" aria-label="radio progress">
							<div class="progress-fill" style={`width: ${progressPercent}%`}></div>
						</div>
						<span>{formatTime(duration)}</span>
					</div>

					<div class="volume-control">
						<label for="radio-volume">volume</label>
						<input
							id="radio-volume"
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={volume}
							oninput={handleVolumeInput}
							onpointerdown={tuneIn}
							aria-label="radio volume"
						/>
					</div>
				</div>
			</div>
		{:else}
			<div class="status">no tracks in rotation yet</div>
		{/if}
	</section>

	{#if radioState && radioState.up_next.length > 0}
		<section class="queue-strip" aria-label="up next">
			<div class="section-heading">
				<h2>up next</h2>
				<span>{radioState.rotation.length} in rotation</span>
			</div>
			<div class="up-next">
				{#each radioState.up_next as track (track.id)}
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
		letter-spacing: 0;
	}

	h1 {
		margin: 0;
		font-size: clamp(3rem, 13vw, 7rem);
		line-height: 0.9;
		letter-spacing: 0;
	}

	.subtitle {
		max-width: 38rem;
		margin: 1rem 0 0;
		color: var(--text-secondary);
		font-size: var(--text-lg);
		line-height: 1.45;
	}

	.now {
		display: grid;
		grid-template-columns: minmax(15rem, 0.78fr) minmax(0, 1fr);
		gap: 2rem;
		align-items: end;
	}

	.radio-face {
		width: 100%;
		max-width: 28rem;
		border: 1px solid var(--border-default);
		background: var(--bg-secondary);
	}

	.speaker {
		aspect-ratio: 1;
		margin: 1rem;
		overflow: hidden;
		border: 1px solid var(--border-default);
		background:
			repeating-linear-gradient(
				90deg,
				rgba(255, 255, 255, 0.08) 0,
				rgba(255, 255, 255, 0.08) 1px,
				transparent 1px,
				transparent 8px
			),
			var(--bg-primary);
	}

	.art {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.art.fallback,
	.thumb-fallback {
		width: 100%;
		height: 100%;
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
			var(--bg-secondary);
	}

	.track-panel {
		min-width: 0;
		padding-bottom: 0.25rem;
	}

	.track-meta h2 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 4rem);
		line-height: 1;
		letter-spacing: 0;
		overflow-wrap: anywhere;
	}

	.artist {
		display: inline-block;
		margin-top: 0.75rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-lg);
	}

	.artist:hover,
	.next-track:hover strong {
		color: var(--text-primary);
	}

	.progress-row {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr) 3.25rem;
		align-items: center;
		gap: 0.75rem;
		margin-top: 2rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
	}

	.progress {
		height: 0.45rem;
		border-radius: 999px;
		background: var(--bg-secondary);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--text-primary);
	}

	.receiver {
		display: grid;
		gap: 0.75rem;
		padding: 0 1rem 1rem;
	}

	.signal-row {
		display: flex;
		align-items: end;
		gap: 0.35rem;
	}

	.signal-row span {
		width: 0.35rem;
		height: 0.55rem;
		background: var(--text-tertiary);
		opacity: 0.35;
	}

	.signal-row span:nth-child(2) {
		height: 0.8rem;
	}

	.signal-row span:nth-child(3) {
		height: 1.05rem;
	}

	.signal-row span:nth-child(4) {
		height: 1.3rem;
	}

	.signal-row span.active {
		background: var(--text-primary);
		opacity: 1;
	}

	.frequency {
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	.needle-track {
		position: relative;
		height: 1.8rem;
		border-top: 1px solid var(--border-default);
		border-bottom: 1px solid var(--border-default);
		background:
			repeating-linear-gradient(
				90deg,
				var(--border-default) 0,
				var(--border-default) 1px,
				transparent 1px,
				transparent 10%
			),
			var(--bg-primary);
	}

	.needle {
		position: absolute;
		top: -0.25rem;
		bottom: -0.25rem;
		width: 2px;
		background: var(--text-primary);
		transform: translateX(-1px);
	}

	.volume-control {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.85rem;
		margin-top: 1.5rem;
		color: var(--text-secondary);
	}

	.volume-control label {
		font-size: var(--text-sm);
		font-weight: 700;
	}

	.volume-control input {
		width: 100%;
		accent-color: var(--text-primary);
		cursor: pointer;
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
		letter-spacing: 0;
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

		.now {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}

		.radio-face {
			max-width: none;
		}

		.progress-row {
			grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
		}
	}
</style>
