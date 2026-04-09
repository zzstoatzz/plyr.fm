<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import Waveform from '$lib/components/Waveform.svelte';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';
	import { uploader } from '$lib/uploader.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import logo from '$lib/assets/logo.png';

	type RecordState = 'idle' | 'recording' | 'preview' | 'uploading';

	const MAX_SECONDS = 600;
	const WARN_SECONDS = 540;

	let uiState = $state<RecordState>('idle');
	let elapsedSeconds = $state(0);
	let title = $state('');
	let tags = $state<string[]>([]);
	let previewUrl = $state<string | null>(null);
	let previewBlob = $state<Blob | null>(null);
	let audioEl = $state<HTMLAudioElement | null>(null);
	let currentTime = $state(0);
	let duration = $state(0);
	let isPlaying = $state(false);
	const playbackProgress = $derived(duration > 0 ? currentTime / duration : 0);
	const timeDisplay = $derived(`${formatTime(currentTime)} / ${formatTime(duration)}`);

	function handleSeek(ratio: number) {
		if (audioEl && duration > 0) {
			audioEl.currentTime = ratio * duration;
		}
	}

	function togglePlay() {
		if (!audioEl) return;
		if (isPlaying) audioEl.pause();
		else audioEl.play().catch((e) => console.error('playback failed:', e));
	}

	let mediaRecorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let timerHandle: number | null = null;
	let warnedNearLimit = false;

	const elapsedDisplay = $derived(formatTime(elapsedSeconds));

	function formatTime(seconds: number): string {
		const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
		const ss = Math.floor(seconds % 60).toString().padStart(2, '0');
		return `${mm}:${ss}`;
	}

	function pickSupportedMime(): string | null {
		const candidates = [
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/mp4',
			'audio/ogg;codecs=opus',
			'audio/ogg'
		];
		for (const c of candidates) {
			if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
				return c;
			}
		}
		return null;
	}

	function extensionFor(mime: string): string {
		if (mime.includes('webm')) return 'webm';
		if (mime.includes('mp4')) return 'm4a';
		if (mime.includes('ogg')) return 'ogg';
		return 'webm';
	}

	function startTimer() {
		stopTimer();
		elapsedSeconds = 0;
		warnedNearLimit = false;
		timerHandle = window.setInterval(() => {
			elapsedSeconds += 1;
			if (elapsedSeconds === WARN_SECONDS && !warnedNearLimit) {
				warnedNearLimit = true;
				toast.info('1 minute until auto-stop');
			}
			if (elapsedSeconds >= MAX_SECONDS) {
				stopRecording();
			}
		}, 1000);
	}

	function stopTimer() {
		if (timerHandle !== null) {
			window.clearInterval(timerHandle);
			timerHandle = null;
		}
	}

	async function startRecording() {
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			console.error('mic permission error:', e);
			toast.error('microphone permission denied');
			return;
		}
		chunks = [];
		const mime = pickSupportedMime();
		try {
			mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
		} catch (e) {
			console.error('mediarecorder init error:', e);
			toast.error('your browser does not support audio recording');
			stream?.getTracks().forEach((t) => t.stop());
			stream = null;
			return;
		}
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		mediaRecorder.onstop = finalizeRecording;
		mediaRecorder.start();
		uiState = 'recording';
		startTimer();
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		stopTimer();
	}

	function finalizeRecording() {
		const mime = mediaRecorder?.mimeType ?? 'audio/webm';
		const blob = new Blob(chunks, { type: mime });
		previewBlob = blob;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(blob);
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		title = `recording ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
		tags = ['voice-memo'];
		uiState = 'preview';
	}

	function reRecord() {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
		previewBlob = null;
		chunks = [];
		title = '';
		tags = [];
		elapsedSeconds = 0;
		uiState = 'idle';
	}

	function handleUpload() {
		if (!previewBlob) return;
		const ext = extensionFor(previewBlob.type);
		const safeTitle = title.replace(/[^\w\s.-]/g, '_').trim() || `recording-${Date.now()}`;
		const file = new File([previewBlob], `${safeTitle}.${ext}`, { type: previewBlob.type });
		uploader.upload(
			file,
			title,
			'',
			[],
			null,
			tags,
			false,
			false,
			'',
			() => {},
			undefined,
			title
		);
		uiState = 'uploading';
		goto(`/u/${auth.user?.handle ?? ''}`);
	}

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	onMount(async () => {
		await auth.initialize();
	});

	onDestroy(() => {
		stopTimer();
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			try {
				mediaRecorder.stop();
			} catch (e) {
				console.error('error stopping recorder on destroy:', e);
			}
		}
		stream?.getTracks().forEach((t) => t.stop());
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
		<p class="subtitle">capture audio from your mic, upload to plyr.fm as a track</p>
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
			<div class="mic-aura recording">
				<button type="button" class="record-btn recording" onclick={stopRecording} aria-label="stop recording">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<rect x="6" y="6" width="12" height="12" rx="2" />
					</svg>
				</button>
			</div>
			<p class="hint">tap to stop · auto-stop at 10:00</p>
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
					upload
				</button>
			</div>
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
		margin-bottom: 2rem;
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
		gap: 1.5rem;
		padding: 3rem 1rem;
	}

	/* ambient radial glow behind the mic — subtle in idle, stronger when recording */
	.mic-aura {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
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
			color-mix(in srgb, var(--accent) 38%, transparent),
			transparent 68%
		);
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
		transform: translateY(0);
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
		font-size: 3rem;
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
		border-radius: var(--radius-md);
		padding: 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
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
		width: 42px;
		height: 42px;
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
		transform: translateY(0);
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
		gap: 0.5rem;
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

	@media (max-width: 600px) {
		.record-btn {
			width: 120px;
			height: 120px;
		}
		.timer {
			font-size: 2.5rem;
		}
		.actions {
			justify-content: stretch;
		}
		.primary-btn,
		.secondary-btn {
			flex: 1;
			justify-content: center;
		}
	}
</style>
