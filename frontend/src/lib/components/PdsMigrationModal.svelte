<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { API_URL } from '$lib/config';
	import type { Track } from '$lib/types';

	interface Props {
		tracks: Track[];
		open: boolean;
		onClose: () => void;
		onComplete?: () => void | Promise<void>;
	}

	let { tracks, open = $bindable(), onClose, onComplete }: Props = $props();

	// -- state --

	let selected = new SvelteSet<number>();
	let fileSizes = $state<Record<number, number>>({});

	type MigrationPhase = 'idle' | 'migrating' | 'done';
	let phase = $state<MigrationPhase>('idle');
	let processedCount = $state(0);
	let totalCount = $state(0);
	let backfilledCount = $state(0);
	let skippedCount = $state(0);
	let failedCount = $state(0);
	let lastStatus = $state('');
	let eventSource: EventSource | null = null;

	// per-track migration status from SSE events
	let trackMigrationStatus = $state<Record<number, 'pending' | 'backfilled' | 'skipped' | 'failed'>>({});

	// -- derived --

	let eligible = $derived(
		tracks.filter((t) => !t.support_gate && !t.pds_blob_cid && t.file_id)
	);

	let allSelected = $derived(
		eligible.length > 0 && eligible.every((t) => selected.has(t.id))
	);

	let selectedBytes = $derived(
		[...selected].reduce((sum, id) => sum + (fileSizes[id] ?? 0), 0)
	);

	// -- helpers --

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function trackStatus(track: Track): 'eligible' | 'migrated' | 'gated' {
		if (track.support_gate) return 'gated';
		if (track.audio_storage === 'both' || track.pds_blob_cid) return 'migrated';
		return 'eligible';
	}

	function perTrackMigrationStatus(
		track: Track
	): 'pending' | 'backfilled' | 'skipped' | 'failed' | null {
		if (phase === 'idle') return null;
		if (!selected.has(track.id)) return null;
		return trackMigrationStatus[track.id] ?? 'pending';
	}

	// -- effects --

	function resetState() {
		selected.clear();
		phase = 'idle';
		processedCount = 0;
		totalCount = 0;
		backfilledCount = 0;
		skippedCount = 0;
		failedCount = 0;
		lastStatus = '';
		trackMigrationStatus = {};
	}

	$effect(() => {
		if (open) {
			resetState();
			fetchFileSizes();
		}
	});

	$effect(() => {
		if (!open) return;

		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape' && phase !== 'migrating') {
				onClose();
			}
		}

		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	// -- actions --

	async function fetchFileSizes() {
		try {
			const res = await fetch(`${API_URL}/tracks/me/file-sizes`, { credentials: 'include' });
			if (res.ok) {
				const data: { sizes: Record<string, number> } = await res.json();
				const mapped: Record<number, number> = {};
				for (const [k, v] of Object.entries(data.sizes)) mapped[Number(k)] = v;
				fileSizes = mapped;
			}
		} catch { /* sizes are non-critical */ }
	}

	function toggleTrack(id: number) {
		if (selected.has(id)) {
			selected.delete(id);
		} else {
			selected.add(id);
		}
	}

	function toggleAll() {
		if (allSelected) {
			selected.clear();
		} else {
			selected.clear();
			for (const t of eligible) {
				selected.add(t.id);
			}
		}
	}

	async function startMigration() {
		if (selected.size === 0) return;

		phase = 'migrating';
		totalCount = selected.size;
		processedCount = 0;
		backfilledCount = 0;
		skippedCount = 0;
		failedCount = 0;
		lastStatus = '';

		// mark all selected as pending
		const statusMap: Record<number, 'pending' | 'backfilled' | 'skipped' | 'failed'> = {};
		for (const id of selected) {
			statusMap[id] = 'pending';
		}
		trackMigrationStatus = statusMap;

		try {
			const res = await fetch(`${API_URL}/pds-backfill/audio`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ track_ids: [...selected] }),
			});

			if (!res.ok) {
				lastStatus = 'failed to start migration';
				phase = 'done';
				return;
			}

			const data = await res.json();
			listenToProgress(data.backfill_id);
		} catch {
			lastStatus = 'network error';
			phase = 'done';
		}
	}

	function listenToProgress(backfillId: string) {
		eventSource?.close();
		eventSource = new EventSource(
			`${API_URL}/pds-backfill/${backfillId}/progress`,
		);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.status) lastStatus = data.status;
				if (data.processed_count != null) processedCount = data.processed_count;
				if (data.total_count != null) totalCount = data.total_count;
				if (data.backfilled_count != null) backfilledCount = data.backfilled_count;
				if (data.skipped_count != null) skippedCount = data.skipped_count;
				if (data.failed_count != null) failedCount = data.failed_count;
				if (data.last_processed_track_id != null && data.last_status) {
					trackMigrationStatus = {
						...trackMigrationStatus,
						[data.last_processed_track_id]: data.last_status
					};
				}

				if (data.status === 'completed' || data.status === 'failed') {
					eventSource?.close();
					eventSource = null;
					phase = 'done';
					if (data.status === 'completed') {
						onComplete?.();
					}
				}
			} catch {
				// ignore parse errors
			}
		};

		eventSource.onerror = () => {
			eventSource?.close();
			eventSource = null;
			if (phase === 'migrating') {
				lastStatus = 'connection lost';
				phase = 'done';
			}
		};
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget && phase !== 'migrating') {
			onClose();
		}
	}

	function handleClose() {
		if (phase !== 'migrating') {
			onClose();
		}
	}
</script>

<div
	class="pds-backdrop"
	class:open
	role="presentation"
	onclick={handleBackdropClick}
>
	<div class="pds-modal" role="dialog" aria-modal="true" aria-label="migrate tracks to pds">
		<!-- header -->
		<div class="pds-header">
			<h2 class="pds-title">migrate to pds</h2>
			<button
				class="pds-close-btn"
				onclick={handleClose}
				disabled={phase === 'migrating'}
				aria-label="close"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>

		{#if phase === 'idle'}
			<p class="pds-description">
				select tracks to back up to your personal data server.
				gated and already-migrated tracks are shown for reference.
			</p>
		{/if}

		<!-- progress bar during migration -->
		{#if phase === 'migrating' || phase === 'done'}
			<div class="pds-progress-section">
				<div class="pds-progress-bar-track">
					<div
						class="pds-progress-bar-fill"
						style="width: {totalCount > 0 ? (processedCount / totalCount) * 100 : 0}%"
					></div>
				</div>
				<div class="pds-progress-text">
					{#if phase === 'migrating'}
						migrating... {processedCount} / {totalCount}
					{:else if lastStatus === 'completed'}
						done — {backfilledCount} migrated{#if skippedCount > 0}, {skippedCount} skipped{/if}{#if failedCount > 0}, {failedCount} failed{/if}
					{:else}
						{lastStatus}
					{/if}
				</div>
			</div>
		{/if}

		<!-- select all (only in idle phase) -->
		{#if phase === 'idle' && eligible.length > 0}
			<label class="pds-select-all">
				<input
					type="checkbox"
					checked={allSelected}
					onchange={toggleAll}
				/>
				<span>select all eligible ({eligible.length})</span>
			</label>
		{/if}

		<!-- track list -->
		<div class="pds-track-list">
			{#each tracks as track (track.id)}
				{@const status = trackStatus(track)}
				{@const migStatus = perTrackMigrationStatus(track)}
				<div class="pds-track-row" class:dimmed={status !== 'eligible'}>
					<div class="pds-track-checkbox">
						{#if status === 'eligible' && phase === 'idle'}
							<input
								type="checkbox"
								checked={selected.has(track.id)}
								onchange={() => toggleTrack(track.id)}
							/>
						{:else}
							<div class="pds-track-checkbox-placeholder"></div>
						{/if}
					</div>
					<div class="pds-track-info">
						<span class="pds-track-title">{track.title}</span>
						<span class="pds-track-artist">{track.artist}</span>
					</div>
					<div class="pds-track-meta">
						{#if fileSizes[track.id]}
							<span class="pds-track-size">{formatBytes(fileSizes[track.id])}</span>
						{/if}
						{#if status === 'migrated'}
							<span class="pds-badge migrated">on pds</span>
						{:else if status === 'gated'}
							<span class="pds-badge gated">gated</span>
						{:else if migStatus === 'backfilled'}
							<span class="pds-badge migrated">done</span>
						{:else if migStatus === 'skipped'}
							<span class="pds-badge gated">skipped</span>
						{:else if migStatus === 'failed'}
							<span class="pds-badge failed">failed</span>
						{:else if migStatus === 'pending'}
							<span class="pds-badge processing">queued</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- footer -->
		<div class="pds-footer">
			{#if phase === 'idle'}
				<button
					class="pds-migrate-btn"
					disabled={selected.size === 0}
					onclick={startMigration}
				>
					migrate {selected.size} track{selected.size !== 1 ? 's' : ''}{#if selectedBytes > 0}
						({formatBytes(selectedBytes)})
					{/if}
				</button>
			{:else if phase === 'done'}
				<button class="pds-close-done-btn" onclick={handleClose}>
					close
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.pds-backdrop {
		position: fixed; inset: 0; z-index: 9999;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
		display: flex; align-items: center; justify-content: center;
		opacity: 0; pointer-events: none; transition: opacity 0.15s;
	}
	.pds-backdrop.open { opacity: 1; pointer-events: auto; }
	.pds-modal {
		width: 100%; max-width: 640px; max-height: 90vh;
		display: flex; flex-direction: column;
		background: color-mix(in srgb, var(--bg-secondary) 95%, transparent);
		backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
		border: 1px solid var(--border-subtle); border-radius: var(--radius-xl);
		box-shadow: 0 24px 80px color-mix(in srgb, var(--bg-primary) 50%, transparent), 0 0 1px var(--border-subtle) inset;
		padding: 1.5rem; margin: 0 1rem;
	}
	.pds-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.75rem; flex-shrink: 0;
	}
	.pds-title { font-size: var(--text-xl); font-weight: 600; color: var(--text-primary); margin: 0; }
	.pds-close-btn {
		display: flex; align-items: center; justify-content: center;
		width: 32px; height: 32px; background: transparent;
		border: none; border-radius: var(--radius-base);
		color: var(--text-tertiary); cursor: pointer; transition: all 0.15s;
	}
	.pds-close-btn:hover:not(:disabled) { background: var(--bg-tertiary); color: var(--text-primary); }
	.pds-close-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.pds-description { font-size: var(--text-sm); color: var(--text-tertiary); margin: 0 0 1rem 0; line-height: 1.5; flex-shrink: 0; }
	.pds-progress-section { margin-bottom: 1rem; flex-shrink: 0; }
	.pds-progress-bar-track { width: 100%; height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; margin-bottom: 0.5rem; }
	.pds-progress-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s ease; }
	.pds-progress-text { font-size: var(--text-sm); color: var(--text-secondary); }
	.pds-select-all {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: var(--text-sm); color: var(--text-secondary);
		cursor: pointer; padding: 0.5rem 0; margin-bottom: 0.25rem; flex-shrink: 0;
	}
	.pds-select-all input[type='checkbox'],
	.pds-track-checkbox input[type='checkbox'] { accent-color: var(--accent); }
	.pds-track-list {
		overflow-y: auto; flex: 1; min-height: 0;
		border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle);
		margin-bottom: 1rem;
	}
	.pds-track-row {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.625rem 0.25rem; border-bottom: 1px solid var(--border-subtle); transition: opacity 0.15s;
	}
	.pds-track-row:last-child { border-bottom: none; }
	.pds-track-row.dimmed { opacity: 0.5; }
	.pds-track-checkbox { flex-shrink: 0; width: 20px; display: flex; align-items: center; justify-content: center; }
	.pds-track-checkbox-placeholder { width: 16px; height: 16px; }
	.pds-track-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }
	.pds-track-title, .pds-track-artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pds-track-title { font-size: var(--text-sm); color: var(--text-primary); }
	.pds-track-artist { font-size: var(--text-xs); color: var(--text-tertiary); }
	.pds-track-meta { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
	.pds-track-size { font-size: var(--text-xs); color: var(--text-tertiary); white-space: nowrap; }
	.pds-badge { font-size: var(--text-xs); padding: 0.125rem 0.5rem; border-radius: var(--radius-md); white-space: nowrap; font-weight: 500; }
	.pds-badge.migrated { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
	.pds-badge.gated { background: color-mix(in srgb, var(--text-tertiary) 15%, transparent); color: var(--text-tertiary); }
	.pds-badge.processing { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); animation: pulse-badge 1.5s ease-in-out infinite; }
	.pds-badge.failed { background: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error); }
	@keyframes pulse-badge { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	.pds-footer { flex-shrink: 0; }
	.pds-migrate-btn {
		width: 100%; padding: 0.75rem 1rem; background: var(--accent); color: var(--bg-primary);
		border: none; border-radius: var(--radius-base); font-family: inherit;
		font-size: var(--text-base); font-weight: 600; cursor: pointer; transition: all 0.15s;
	}
	.pds-migrate-btn:hover:not(:disabled) { background: var(--accent-hover); }
	.pds-migrate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.pds-close-done-btn {
		width: 100%; padding: 0.625rem; background: transparent;
		border: 1px solid var(--border-default); border-radius: var(--radius-base);
		color: var(--text-secondary); font-family: inherit; font-size: var(--text-base);
		cursor: pointer; transition: all 0.15s;
	}
	.pds-close-done-btn:hover { border-color: var(--accent); color: var(--text-primary); }
</style>
