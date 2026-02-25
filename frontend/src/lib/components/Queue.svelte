<script lang="ts">
	import { queue } from '$lib/queue.svelte';
	import { player } from '$lib/player.svelte';
	import { goToIndex } from '$lib/playback.svelte';
	import { jam } from '$lib/jam.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { Track, JamParticipant } from '$lib/types';

	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// touch drag state
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);
	let touchCurrentY = $state(0);
	let touchDragElement = $state<HTMLElement | null>(null);
	let queueTracksElement = $state<HTMLElement | null>(null);

	async function startJam() {
		const trackIds = queue.tracks.map((t) => t.file_id);
		await jam.create(
			undefined,
			trackIds,
			queue.currentIndex,
			!player.paused,
			Math.round(player.currentTime * 1000)
		);
	}

	async function leaveJam() {
		await jam.leave();
	}

	async function shareJam() {
		const url = `${window.location.origin}/jam/${jam.code}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success('link copied');
		} catch {
			toast.error('failed to copy link');
		}
	}

	// when jam is active, show jam tracks; otherwise show personal queue
	const tracks = $derived(jam.active ? jam.tracks : queue.tracks);
	const currentIdx = $derived(jam.active ? jam.currentIndex : queue.currentIndex);
	const currentTrack = $derived.by<Track | null>(() => tracks[currentIdx] ?? null);
	const upcoming = $derived.by<{ track: Track; index: number }[]>(() => {
		return tracks
			.map((track, index) => ({ track, index }))
			.filter(({ index }) => index > currentIdx);
	});

	const outputParticipant = $derived.by<JamParticipant | null>(() => {
		if (!jam.active || !jam.outputDid) return null;
		return jam.participants.find((p) => p.did === jam.outputDid) ?? null;
	});

	function handleTrackClick(index: number) {
		goToIndex(index);
	}

	function handleRemoveTrack(index: number) {
		queue.removeTrack(index);
	}

	// desktop drag and drop
	function handleDragStart(event: DragEvent, index: number) {
		draggedIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		dragOverIndex = index;
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== index) {
			queue.moveTrack(draggedIndex, index);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}

	// touch drag and drop
	function handleTouchStart(event: TouchEvent, index: number) {
		const touch = event.touches[0];
		touchDragIndex = index;
		touchStartY = touch.clientY;
		touchCurrentY = touch.clientY;
		touchDragElement = event.currentTarget as HTMLElement;

		// add dragging class
		touchDragElement.classList.add('touch-dragging');
	}

	function handleTouchMove(event: TouchEvent) {
		if (touchDragIndex === null || !touchDragElement || !queueTracksElement) return;

		event.preventDefault();
		const touch = event.touches[0];
		touchCurrentY = touch.clientY;

		// calculate visual offset
		const offset = touchCurrentY - touchStartY;
		touchDragElement.style.transform = `translateY(${offset}px)`;

		// find which track we're hovering over
		const tracks = queueTracksElement.querySelectorAll('.queue-track');
		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i] as HTMLElement;
			const rect = track.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			if (touch.clientY < midY && i > 0) {
				// get the actual index from the data attribute
				const targetIndex = parseInt(track.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
				break;
			} else if (touch.clientY >= midY) {
				const targetIndex = parseInt(track.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
			}
		}
	}

	function handleTouchEnd() {
		if (touchDragIndex !== null && dragOverIndex !== null && touchDragIndex !== dragOverIndex) {
			queue.moveTrack(touchDragIndex, dragOverIndex);
		}

		// cleanup
		if (touchDragElement) {
			touchDragElement.classList.remove('touch-dragging');
			touchDragElement.style.transform = '';
		}

		touchDragIndex = null;
		dragOverIndex = null;
		touchDragElement = null;
	}
</script>

{#if tracks.length > 0}
	<div class="queue" class:jam-mode={jam.active}>
		<div class="queue-header">
			{#if jam.active}
				<div class="jam-header-row">
					<div class="jam-identity">
						<span class="connection-dot" class:connected={jam.connected} class:reconnecting={jam.reconnecting}></span>
						<span class="jam-name">{jam.jam?.name ?? 'jam'}</span>
						<span class="jam-code">{jam.code}</span>
					</div>
					<div class="queue-actions">
						{#if upcoming.length > 0}
							<button
								class="clear-btn"
								onclick={() => queue.clearUpNext()}
								title="clear upcoming tracks"
							>
								clear
							</button>
						{/if}
						<button class="share-btn" onclick={shareJam} title="share jam link">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="18" cy="5" r="3"></circle>
								<circle cx="6" cy="12" r="3"></circle>
								<circle cx="18" cy="19" r="3"></circle>
								<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
								<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
							</svg>
						</button>
						<button class="leave-btn" onclick={leaveJam} title="leave jam">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
								<polyline points="16 17 21 12 16 7"></polyline>
								<line x1="21" y1="12" x2="9" y2="12"></line>
							</svg>
						</button>
					</div>
				</div>
				<div class="jam-output-row">
					<span class="output-status">
						{#if jam.outputMode === 'everyone'}
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
							everyone plays
						{:else if jam.isOutputDevice}
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
							playing here
						{:else}
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
							<span class="output-name">{outputParticipant ? (outputParticipant.display_name ?? outputParticipant.handle) : 'elsewhere'}</span>
							<button class="pill-btn" onclick={() => jam.setOutput()}>play here</button>
						{/if}
					</span>
					{#if jam.isHost}
						<button class="pill-btn" onclick={() => jam.setMode(jam.outputMode === 'everyone' ? 'one_speaker' : 'everyone')} title={jam.outputMode === 'everyone' ? 'switch to one speaker' : 'let everyone play'}>
							{jam.outputMode === 'everyone' ? 'one speaker' : 'everyone'}
						</button>
					{/if}
				</div>
			{:else}
				<h2>queue</h2>
				<div class="queue-actions">
						<button
						class="jam-btn"
						onclick={startJam}
						title="start a jam"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
							<circle cx="9" cy="7" r="4"></circle>
							<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
							<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
						</svg>
					</button>
					<button
						class="shuffle-btn"
						class:active={queue.shuffle}
						onclick={() => queue.toggleShuffle()}
						title={queue.shuffle ? 'disable shuffle' : 'enable shuffle'}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="16 3 21 3 21 8"></polyline>
							<line x1="4" y1="20" x2="21" y2="3"></line>
							<polyline points="21 16 21 21 16 21"></polyline>
							<line x1="15" y1="15" x2="21" y2="21"></line>
							<line x1="4" y1="4" x2="9" y2="9"></line>
						</svg>
					</button>
					{#if upcoming.length > 0}
						<button
							class="clear-btn"
							onclick={() => queue.clearUpNext()}
							title="clear upcoming tracks"
						>
							clear
						</button>
					{/if}
				</div>
			{/if}
		</div>

		{#if jam.active && jam.participants.length > 0}
			<div class="participants-strip">
				{#each jam.participants as participant (participant.did)}
					<div class="participant-chip" class:is-output={jam.outputMode !== 'everyone' && participant.did === jam.outputDid} title={participant.display_name ?? participant.handle}>
						{#if participant.avatar_url}
							<img src={participant.avatar_url} alt="" class="participant-avatar" />
						{:else}
							<div class="participant-avatar placeholder">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
									<circle cx="12" cy="7" r="4"></circle>
								</svg>
							</div>
						{/if}
						{#if jam.outputMode !== 'everyone' && participant.did === jam.outputDid}
							<div class="speaker-badge">
								<svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none">
									<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
								</svg>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="queue-body">
			{#if currentTrack}
				<section class="now-playing">
					<div class="section-label">now playing</div>
					<div class="now-playing-card">
						<div class="track-info">
							<div class="track-title">{currentTrack.title}</div>
							<div class="track-artist">
								<a href="/u/{currentTrack.artist_handle}">{currentTrack.artist}</a>
							</div>
						</div>

					</div>
				</section>
			{/if}

			<section class="queue-upcoming">
				<div class="section-header">
					<h3>up next</h3>
					<span>{upcoming.length}</span>
				</div>

				{#if upcoming.length > 0}
					<div
						class="queue-tracks"
						role="list"
						bind:this={queueTracksElement}
						ontouchmove={handleTouchMove}
						ontouchend={handleTouchEnd}
						ontouchcancel={handleTouchEnd}
					>
						{#each upcoming as { track, index } (`${track.file_id}:${index}`)}
							<div
								class="queue-track"
								class:drag-over={dragOverIndex === index && touchDragIndex !== index}
								class:is-dragging={touchDragIndex === index || draggedIndex === index}
								data-index={index}
								draggable={true}
								role="button"
								tabindex="0"
								ondragstart={(e) => handleDragStart(e, index)}
								ondragover={(e) => handleDragOver(e, index)}
								ondrop={(e) => handleDrop(e, index)}
								ondragend={handleDragEnd}
								onclick={() => handleTrackClick(index)}
								onkeydown={(e) => e.key === 'Enter' && handleTrackClick(index)}
							>
								<button
									class="drag-handle"
									ontouchstart={(e) => handleTouchStart(e, index)}
									onclick={(e) => e.stopPropagation()}
									aria-label="drag to reorder"
									title="drag to reorder"
								>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
										<circle cx="5" cy="3" r="1.5"></circle>
										<circle cx="11" cy="3" r="1.5"></circle>
										<circle cx="5" cy="8" r="1.5"></circle>
										<circle cx="11" cy="8" r="1.5"></circle>
										<circle cx="5" cy="13" r="1.5"></circle>
										<circle cx="11" cy="13" r="1.5"></circle>
									</svg>
								</button>

								<div class="track-info">
									<div class="track-title">{track.title}</div>
									<div class="track-artist">
										<a href="/u/{track.artist_handle}" onclick={(e) => e.stopPropagation()}>
											{track.artist}
										</a>
									</div>
								</div>

								<button
									class="remove-btn"
									onclick={(e) => {
										e.stopPropagation();
										handleRemoveTrack(index);
									}}
									aria-label="remove from queue"
									title="remove from queue"
								>
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<line x1="18" y1="6" x2="6" y2="18"></line>
										<line x1="6" y1="6" x2="18" y2="18"></line>
									</svg>
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-up-next">
						<span>nothing else in the queue</span>
					</div>
				{/if}
			</section>
		</div>
	</div>
{:else}
	<div class="queue empty">
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M9 18V5l12-2v13"></path>
				<circle cx="6" cy="18" r="3"></circle>
				<circle cx="18" cy="16" r="3"></circle>
			</svg>
			<p>queue is empty</p>
			<span>add tracks to get started</span>
		</div>
	</div>
{/if}

<style>
	.queue {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1.5rem 1.25rem calc(var(--player-height, 0px) + 40px + env(safe-area-inset-bottom, 0px));
		background: transparent;
		gap: 1rem;
	}

	.queue.jam-mode {
		border-top: 2px solid transparent;
		border-image: linear-gradient(90deg, #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b) 1;
	}

	.jam-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.jam-identity {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		overflow: hidden;
	}

	.jam-output-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.output-name {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: inline-block;
		vertical-align: bottom;
	}

	.pill-btn {
		padding: 0.125rem 0.5rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.pill-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.jam-name {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		text-transform: lowercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex-shrink: 1;
	}

	.connection-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--text-tertiary);
		flex-shrink: 0;
		transition: background 0.3s;
	}

	.connection-dot.connected {
		background: #22c55e;
	}

	.connection-dot.reconnecting {
		background: #eab308;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.jam-code {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		font-family: monospace;
		flex-shrink: 0;
	}

	.share-btn,
	.leave-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.share-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.leave-btn:hover {
		color: var(--error);
		border-color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.participants-strip {
		display: flex;
		gap: 0.375rem;
		padding: 0 0.25rem;
		flex-wrap: wrap;
	}

	.participant-chip {
		flex-shrink: 0;
		position: relative;
	}

	.participant-avatar {
		width: 24px;
		height: 24px;
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 1px solid var(--border-subtle);
	}

	.participant-avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
	}

	.queue-header h2 {
		margin: 0;
		font-size: var(--text-lg);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-tertiary);
	}

	.queue-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.jam-mode .queue-header {
		flex-direction: column;
		align-items: stretch;
		gap: 0.375rem;
	}

	.queue-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.shuffle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.shuffle-btn:hover {
		color: var(--text-secondary);
		border-color: var(--border-default);
		background: var(--bg-secondary);
	}

	.shuffle-btn.active {
		color: var(--accent);
		border-color: var(--accent);
	}

	.jam-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.jam-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.clear-btn {
		padding: 0.25rem 0.75rem;
		font-size: var(--text-xs);
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.clear-btn:hover {
		background: var(--bg-secondary);
		color: var(--text-secondary);
		border-color: var(--border-medium);
	}

	.queue-body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		flex: 1;
		overflow: hidden;
	}

	.section-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}

	.now-playing-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.1rem;
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		gap: 1rem;
		box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 15%, transparent);
	}

	.now-playing-card .track-title {
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.35rem;
	}

	.now-playing-card .track-artist {
		font-size: var(--text-base);
		color: var(--text-secondary);
	}

	.now-playing-card .track-artist a {
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
	}

	.now-playing-card .track-artist a:hover {
		color: var(--accent);
	}


	.queue-upcoming {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		gap: 0.75rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.section-header h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.queue-tracks {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-right: 0.35rem;
	}

	.queue-track {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.85rem 0.9rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid var(--border-subtle);
		background: var(--bg-secondary);
		position: relative;
	}

	.queue-track:hover {
		background: var(--bg-hover);
		border-color: var(--border-default);
	}

	.queue-track.drag-over {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.queue-track.is-dragging {
		opacity: 0.9;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	/* applied dynamically via JS during touch drag */
	:global(.queue-track.touch-dragging) {
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: grab;
		touch-action: none;
		border-radius: var(--radius-sm);
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.drag-handle:hover {
		color: var(--text-secondary);
		background: var(--bg-tertiary);
	}

	.drag-handle:active {
		cursor: grabbing;
		color: var(--accent);
	}

	/* always show drag handle on touch devices */
	@media (pointer: coarse) {
		.drag-handle {
			color: var(--text-tertiary);
		}
	}

	.track-info {
		flex: 1;
		min-width: 0;
	}

	.track-title {
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 0.25rem;
	}

	.track-artist {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.track-artist a {
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
	}

	.track-artist a:hover {
		color: var(--text-secondary);
	}

	.remove-btn {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		border-radius: var(--radius-sm);
		opacity: 0;
		flex-shrink: 0;
	}

	.queue-track:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	/* always show remove button on touch devices */
	@media (pointer: coarse) {
		.remove-btn {
			opacity: 1;
		}
	}

	.empty-up-next {
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-base);
		padding: 1.25rem;
		text-align: center;
		color: var(--text-tertiary);
	}

	.queue.empty {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.empty-state {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}

	.empty-state svg {
		margin-bottom: 1rem;
		opacity: 0.5;
	}

	.empty-state p {
		margin: 0.5rem 0 0.25rem;
		font-size: var(--text-xl);
		color: var(--text-secondary);
	}

	.empty-state span {
		font-size: var(--text-base);
	}

	.queue-tracks::-webkit-scrollbar {
		width: 8px;
	}

	.queue-tracks::-webkit-scrollbar-track {
		background: transparent;
	}

	.queue-tracks::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: var(--radius-sm);
	}

	.queue-tracks::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}

	.output-status {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		min-width: 0;
		overflow: hidden;
	}

	.speaker-badge {
		position: absolute;
		bottom: -2px;
		right: -2px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--bg-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1.5px solid var(--bg-primary);
	}
</style>
