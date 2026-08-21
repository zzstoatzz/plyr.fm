<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import Waveform from '$lib/components/Waveform.svelte';
	import VisibilityPicker, { type Visibility } from '$lib/components/VisibilityPicker.svelte';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';
	import { uploader } from '$lib/uploader.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import { setReturnUrl } from '$lib/utils/return-url';
	import {
		clearStashedRecording,
		stashRecording,
		takeStashedRecording
	} from '$lib/record-stash';
	import { Recorder, RecorderError, extensionForMime } from '$lib/recorder.svelte';
	import { isWebPlayableExtension } from '$lib/utils/web-playable';
	import { toWav } from '$lib/audio/wav';
	import logo from '$lib/assets/logo.png';

	type RecordState = 'idle' | 'recording' | 'preview' | 'converting' | 'uploading';

	const MAX_SECONDS = 600;
	const WARN_SECONDS = 540;

	let uiState = $state<RecordState>('idle');
	let title = $state('');
	let tags = $state<string[]>([]);
	let visibility = $state<Visibility>('public');
	let previewUrl = $state<string | null>(null);
	let previewBlob = $state<Blob | null>(null);
	let audioEl = $state<HTMLAudioElement | null>(null);
	let currentTime = $state(0);
	let duration = $state(0);
	let isPlaying = $state(false);
	// captured at recording stop-time from the live-tick counter. gives us a
	// correct (1s-resolution) display duration immediately, before the browser
	// has finished scanning the blob for its real length. we prefer the audio
	// element's duration once it becomes a positive finite number, but fall
	// back to this so the UI never shows "0:00" for a valid recording.
	let capturedDuration = $state(0);

	const reducedMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const permissionedSupported = $derived(
		auth.user?.permissioned_spaces?.supported ?? false
	);
	const permissionedGranted = $derived(
		auth.user?.permissioned_spaces?.granted ?? false
	);


	const effectiveDuration = $derived(
		Number.isFinite(duration) && duration > 0 ? duration : capturedDuration
	);
	const playbackProgress = $derived(
		effectiveDuration > 0 ? currentTime / effectiveDuration : 0
	);
	const timeDisplay = $derived(
		`${formatTime(currentTime)} / ${formatTime(effectiveDuration)}`
	);
	const recorder = new Recorder({
		maxSeconds: MAX_SECONDS,
		warnAtSeconds: WARN_SECONDS,
		measureLevel: !reducedMotion,
		onWarn: () => toast.info('1 minute until auto-stop'),
		onStop: finalizeRecording
	});

	const remainingDisplay = $derived(
		formatTime(Math.max(0, MAX_SECONDS - recorder.elapsedSeconds))
	);

	function handleSeek(ratio: number) {
		if (audioEl && effectiveDuration > 0) {
			audioEl.currentTime = ratio * effectiveDuration;
		}
	}

	function togglePlay() {
		if (!audioEl) return;
		if (isPlaying) audioEl.pause();
		else audioEl.play().catch((e) => console.error('playback failed:', e));
	}

	function isUsableDuration(d: number): boolean {
		return Number.isFinite(d) && d > 0;
	}

	// MediaRecorder-produced webm/ogg blobs have no duration written into the
	// container header — the recorder streams output without knowing the final
	// length. different browsers surface this as Infinity (Firefox), 0 (some
	// Chrome versions), or NaN until the file is scanned to EOF. the
	// MDN-documented fix is to seek to a huge time value; the browser clamps
	// to real EOF, scans the file, and emits a `durationchange` with the real
	// duration, at which point we reset currentTime to 0.
	function handleLoadedMetadata() {
		if (!audioEl) return;
		if (isUsableDuration(audioEl.duration)) return;

		const el = audioEl;
		const onDurationChange = () => {
			if (isUsableDuration(el.duration)) {
				el.currentTime = 0;
				el.removeEventListener('durationchange', onDurationChange);
			}
		};
		el.addEventListener('durationchange', onDurationChange);
		// jump past any plausible duration — the browser clamps to real EOF
		el.currentTime = 1e101;
	}

	const elapsedDisplay = $derived(formatTime(recorder.elapsedSeconds));

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const mm = Math.floor(seconds / 60)
			.toString()
			.padStart(2, '0');
		const ss = Math.floor(seconds % 60)
			.toString()
			.padStart(2, '0');
		return `${mm}:${ss}`;
	}

	async function startRecording() {
		try {
			await recorder.start();
			uiState = 'recording';
		} catch (e) {
			toast.error(e instanceof RecorderError ? e.message : "couldn't start recording");
		}
	}

	function finalizeRecording(blob: Blob, elapsedSeconds: number) {
		previewBlob = blob;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(blob);
		// capture the elapsed tick count as a fallback duration — shown until
		// the audio element reports a real positive finite duration
		capturedDuration = elapsedSeconds;
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		title = `recording ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
		tags = ['voice memo'];
		uiState = 'preview';
	}

	function reRecord() {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
		previewBlob = null;
		title = '';
		tags = [];
		currentTime = 0;
		duration = 0;
		capturedDuration = 0;
		isPlaying = false;
		void clearStashedRecording();
		uiState = 'idle';
	}

	function recordingFile(blob: Blob): File {
		const ext = extensionForMime(blob.type);
		const safeTitle = title.replace(/[^\w\s.-]/g, '_').trim() || `recording-${Date.now()}`;
		return new File([blob], `${safeTitle}.${ext}`, { type: blob.type });
	}

	/**
	 * Private media is stored in the space exactly as uploaded, so a container
	 * the browser can't play natively (Firefox's webm/opus) is re-encoded to WAV
	 * here rather than refused.
	 */
	async function preparedForPrivate(blob: Blob): Promise<Blob | null> {
		if (isWebPlayableExtension(extensionForMime(blob.type))) return blob;
		try {
			return await toWav(blob);
		} catch (e) {
			console.error('could not convert the recording:', e);
			toast.error("couldn't prepare your recording");
			return null;
		}
	}

	/**
	 * Trade the recording for the one-time private-media consent.
	 *
	 * The consent round trip leaves the page, so the blob goes to IndexedDB
	 * first and is restored on the way back. Returns false when the upgrade
	 * could not be started, leaving the recording on screen.
	 */
	async function upgradeForPrivate(blob: Blob): Promise<boolean> {
		const stashed = await stashRecording({
			blob,
			title,
			tags: $state.snapshot(tags),
			visibility: 'private',
			capturedDuration
		});
		if (!stashed) {
			toast.error("couldn't save your recording");
			return false;
		}
		try {
			const res = await fetch(`${API_URL}/auth/scope-upgrade/start`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ include_teal: false, include_permissioned: true })
			});
			if (!res.ok) {
				const detail = await res.json().catch(() => null);
				await clearStashedRecording();
				if (detail?.detail === 'spaces_refused') {
					toast.error("your PDS refused private media", 8000);
					await auth.refresh();
				} else {
					toast.error("couldn't start approval");
				}
				return false;
			}
			const data = await res.json();
			toast.info('approving private media — your recording is saved', 6000);
			setReturnUrl('/record');
			if (browser && data.auth_url) window.location.href = data.auth_url;
			return true;
		} catch (e) {
			console.error('scope upgrade failed:', e);
			await clearStashedRecording();
			toast.error("couldn't start approval");
			return false;
		}
	}

	async function handleUpload() {
		if (!previewBlob) return;
		let blob = previewBlob;

		if (visibility === 'private') {
			uiState = 'converting';
			const prepared = await preparedForPrivate(blob);
			if (!prepared) {
				uiState = 'preview';
				return;
			}
			blob = prepared;
		}

		if (visibility === 'private' && !permissionedGranted) {
			uiState = 'uploading';
			if (!(await upgradeForPrivate(blob))) uiState = 'preview';
			return;
		}

		uploader.upload(
			recordingFile(blob),
			title,
			'',
			[],
			null,
			tags,
			visibility,
			false,
			'',
			() => {},
			undefined,
			title
		);
		uiState = 'uploading';
		void clearStashedRecording();
		goto(`/u/${auth.user?.handle ?? ''}`);
	}

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function restoreStashedRecording() {
		const stashed = await takeStashedRecording();
		if (!stashed) return;
		previewBlob = stashed.blob;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(stashed.blob);
		title = stashed.title;
		tags = stashed.tags;
		capturedDuration = stashed.capturedDuration;
		uiState = 'preview';
		if (!permissionedGranted) {
			toast.error("not approved — your recording is still here", 6000);
			return;
		}
		visibility = 'private';
		toast.success('approved — saving your recording', 4000);
		await handleUpload();
	}

	onMount(async () => {
		await auth.initialize();
		await restoreStashedRecording();
	});

	onDestroy(() => {
		recorder.dispose();
		if (previewUrl) URL.revokeObjectURL(previewUrl);
	});
</script>

<svelte:head>
	<title>record • {APP_NAME}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta
		name="description"
		content="capture audio from your mic and upload to {APP_NAME} in one step"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="record • {APP_NAME}" />
	<meta
		property="og:description"
		content="capture audio from your mic and upload to {APP_NAME} in one step"
	/>
	<meta property="og:url" content="{APP_CANONICAL_URL}/record" />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="og:image" content={logo} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="record • {APP_NAME}" />
	<meta
		name="twitter:description"
		content="capture audio from your mic and upload to {APP_NAME} in one step"
	/>
	<meta name="twitter:image" content={logo} />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<main>
	<div class="section-header">
		<h2>record</h2>
		<p class="subtitle">capture audio from your mic, publish it as a track</p>
	</div>

	{#if uiState === 'idle'}
		<div class="stage">
			<div class="mic-aura">
				<button type="button" class="record-btn" onclick={startRecording} aria-label="start recording">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
						<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
						<line x1="12" y1="19" x2="12" y2="23" />
						<line x1="8" y1="23" x2="16" y2="23" />
					</svg>
				</button>
			</div>
			<p class="hint">tap the mic to start</p>
		</div>
	{:else if uiState === 'recording'}
		<div class="stage">
			<div class="timer" aria-live="polite">{elapsedDisplay}</div>
			<div
				class="mic-aura recording"
				style="--input-level: {recorder.inputLevel.toFixed(3)}"
			>
				<button type="button" class="record-btn recording" onclick={() => recorder.stop()} aria-label="stop recording">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<rect x="6" y="6" width="12" height="12" rx="2" />
					</svg>
				</button>
			</div>
			<p class="hint">tap to stop · {remainingDisplay} left</p>
		</div>
	{:else if uiState === 'preview'}
		<div class="preview-card">
			{#if previewBlob}
				<div class="wf-wrap">
					<Waveform
						source={previewBlob}
						progress={playbackProgress}
						onSeek={handleSeek}
						height={96}
					/>
				</div>
			{/if}
			{#if previewUrl}
				<!-- hidden native element — custom controls below drive it -->
				<audio
					bind:this={audioEl}
					bind:currentTime
					bind:duration
					src={previewUrl}
					onloadedmetadata={handleLoadedMetadata}
					onplay={() => (isPlaying = true)}
					onpause={() => (isPlaying = false)}
					onended={() => (isPlaying = false)}
				></audio>
				<div class="playback-row">
					<button
						type="button"
						class="play-btn"
						onclick={togglePlay}
						aria-label={isPlaying ? 'pause' : 'play'}
					>
						{#if isPlaying}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<rect x="6" y="5" width="4" height="14" rx="1" />
								<rect x="14" y="5" width="4" height="14" rx="1" />
							</svg>
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M8 5v14l11-7z" />
							</svg>
						{/if}
					</button>
					<span class="time-display" aria-live="off">{timeDisplay}</span>
				</div>
			{/if}

			<div class="form-group">
				<label for="record-title">title</label>
				<input
					id="record-title"
					type="text"
					bind:value={title}
					maxlength="256"
					placeholder="untitled recording"
				/>
			</div>

			<div class="form-group">
				<label for="record-tags">tags</label>
				<TagInput
					bind:tags
					onAdd={(tag) => {
						tags = [...tags, tag];
					}}
					onRemove={(tag) => {
						tags = tags.filter((t) => t !== tag);
					}}
					placeholder="add tags..."
				/>
			</div>

			<VisibilityPicker
				bind:visibility
				showPrivate={permissionedSupported}
				privateGranted={permissionedGranted}
			/>

			<div class="actions">
				<button type="button" class="secondary-btn" onclick={reRecord}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
					re-record
				</button>
				<button type="button" class="primary-btn" onclick={handleUpload} disabled={!previewBlob}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="17 8 12 3 7 8" />
						<line x1="12" y1="3" x2="12" y2="15" />
					</svg>
					{visibility !== 'private'
						? 'publish'
						: permissionedGranted
							? 'save privately'
							: 'approve private media'}
				</button>
			</div>
		</div>
	{:else if uiState === 'converting'}
		<div class="stage">
			<p class="hint">preparing your recording...</p>
		</div>
	{:else if uiState === 'uploading'}
		<div class="stage">
			<p class="hint">uploading...</p>
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 0 1rem
			calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.section-header {
		margin-bottom: clamp(1.25rem, 4vh, 2rem);
	}

	.section-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.35rem 0;
	}

	.subtitle {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.stage {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(1rem, 3vh, 1.5rem);
		padding: clamp(1.5rem, 6vh, 3rem) 1rem;
	}

	/* ambient radial glow behind the mic — subtle in idle, and while recording
	   it breathes with the live input level */
	.mic-aura {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		--input-level: 0;
	}

	.mic-aura::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(
			circle at center,
			color-mix(in srgb, var(--accent) 22%, transparent),
			transparent 65%
		);
		pointer-events: none;
		z-index: 0;
		transition: background 0.4s ease;
	}

	.mic-aura.recording::before {
		background: radial-gradient(
			circle at center,
			color-mix(
				in srgb,
				var(--accent) calc(30% + var(--input-level) * 45%),
				transparent
			),
			transparent calc(62% + var(--input-level) * 12%)
		);
		transform: scale(calc(1 + var(--input-level) * 0.12));
		transition: transform 0.09s ease-out;
	}

	.record-btn {
		position: relative;
		z-index: 1;
		width: 140px;
		height: 140px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow:
			0 8px 24px color-mix(in srgb, var(--accent) 30%, transparent),
			inset 0 1px 0 color-mix(in srgb, #fff 15%, transparent);
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			background 0.2s ease;
	}

	.record-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.record-btn:active {
		transform: scale(0.96);
	}

	.record-btn.recording {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
		}
		50% {
			box-shadow: 0 0 0 18px color-mix(in srgb, var(--accent) 0%, transparent);
		}
	}

	.timer {
		font-size: clamp(2.25rem, 9vw, 3rem);
		font-weight: 600;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.05em;
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}


	.preview-card {
		background: color-mix(in srgb, var(--track-bg, var(--bg-primary)) 70%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border: 1px solid var(--glass-border, var(--border-subtle));
		border-radius: var(--radius-lg);
		padding: clamp(1.25rem, 4vw, 1.75rem);
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2.5vh, 1.25rem);
		box-shadow: 0 8px 32px color-mix(in srgb, #000 30%, transparent);
	}

	.wf-wrap {
		padding: 0.5rem 0;
	}

	.playback-row {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		margin-top: -0.25rem;
	}

	.play-btn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 28%, transparent);
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
	}

	.play-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.play-btn:active {
		transform: scale(0.94);
	}

	.time-display {
		font-size: var(--text-sm);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group label {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.form-group input[type='text'] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		transition: border-color 0.2s;
	}

	.form-group input[type='text']:focus {
		outline: none;
		border-color: var(--accent);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.primary-btn,
	.secondary-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0.75rem 1.25rem;
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
		transition:
			transform 0.15s ease,
			background 0.2s ease,
			border-color 0.2s ease;
	}

	.primary-btn {
		background: var(--accent);
		color: var(--text-primary);
	}

	.primary-btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.primary-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	.primary-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.secondary-btn {
		background: transparent;
		color: var(--text-muted);
		border-color: var(--border-subtle);
	}

	.secondary-btn:hover {
		color: var(--text-primary);
		border-color: var(--glass-border, var(--border-subtle));
	}

	.secondary-btn:active {
		transform: scale(0.98);
	}

	@media (max-width: 600px) {
		.record-btn {
			width: 120px;
			height: 120px;
		}
		.actions {
			justify-content: stretch;
		}
		.primary-btn,
		.secondary-btn {
			flex: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.record-btn,
		.play-btn,
		.primary-btn,
		.secondary-btn,
		.mic-aura::before,
		.mic-aura.recording::before {
			transition: none;
			animation: none;
			transform: none;
		}
	}
</style>
