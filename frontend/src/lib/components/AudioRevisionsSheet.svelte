<script lang="ts">
	interface RevisionRow {
		id: number;
		track_id: number;
		created_at: string;
		file_type: string;
		original_file_type: string | null;
		audio_storage: string;
		duration: number | null;
		was_gated: boolean;
	}

	interface Props {
		open: boolean;
		trackTitle: string;
		revisions: RevisionRow[];
		loading: boolean;
		error: string | null;
		onClose: () => void;
		onRestore: (revision: RevisionRow) => void;
	}

	let {
		open,
		trackTitle,
		revisions,
		loading,
		error,
		onClose,
		onRestore
	}: Props = $props();

	function formatTime(isoString: string): string {
		const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
		return `${Math.floor(seconds / 604800)}w ago`;
	}

	function formatDuration(seconds: number | null): string {
		if (seconds === null) return '—';
		const total = Math.floor(seconds);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function formatFormat(rev: RevisionRow): string {
		const ft = rev.file_type.toUpperCase();
		if (rev.original_file_type && rev.original_file_type !== rev.file_type) {
			return `format: ${ft} (transcoded from ${rev.original_file_type.toUpperCase()})`;
		}
		return `format: ${ft}`;
	}

	function formatStorage(storage: string): string {
		return storage === 'pds' || storage === 'both' ? 'on your PDS' : 'on plyr.fm';
	}

	function buildSubtitle(rev: RevisionRow): string {
		const parts = [
			formatTime(rev.created_at),
			formatDuration(rev.duration),
			formatStorage(rev.audio_storage)
		];
		if (rev.was_gated) parts.push('was gated');
		return parts.join(' · ');
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}

	function stopPropagation(event: MouseEvent) {
		event.stopPropagation();
	}

	function handleSheetKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}
</script>

<div
	class="sheet-backdrop"
	class:open
	role="presentation"
	onclick={handleBackdropClick}
>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label="version history"
		tabindex="-1"
		onclick={stopPropagation}
		onkeydown={handleSheetKeydown}
	>
		<div class="sheet-handle"></div>
		<div class="sheet-header">
			<div class="sheet-titles">
				<span class="sheet-title">version history</span>
				<span class="sheet-subtitle">{trackTitle}</span>
			</div>
			<button class="sheet-close" onclick={onClose} aria-label="close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>
		<div class="sheet-content">
			{#if loading}
				<div class="sheet-loading">
					{#each [1, 2, 3] as _, i (i)}
						<div class="revision-skeleton">
							<div class="icon-skeleton"></div>
							<div class="text-skeleton-stack">
								<div class="text-skeleton wide"></div>
								<div class="text-skeleton narrow"></div>
							</div>
							<div class="btn-skeleton"></div>
						</div>
					{/each}
				</div>
			{:else if error}
				<div class="sheet-empty error">{error}</div>
			{:else if revisions.length > 0}
				<div class="revisions-list">
					{#each revisions as rev (rev.id)}
						<div class="revision-row">
							<div class="revision-icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M9 18V5l12-2v13"></path>
									<circle cx="6" cy="18" r="3"></circle>
									<circle cx="18" cy="16" r="3"></circle>
								</svg>
							</div>
							<div class="revision-info">
								<span class="revision-format">{formatFormat(rev)}</span>
								<span class="revision-meta">{buildSubtitle(rev)}</span>
							</div>
							<button
								class="restore-btn"
								onclick={() => onRestore(rev)}
							>
								restore
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<div class="sheet-empty">
					no previous versions yet — replace the audio to start building history
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.sheet-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.sheet {
		width: 100%;
		max-width: 480px;
		max-height: 70vh;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-bottom: none;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		display: flex;
		flex-direction: column;
		transform: translateY(100%);
		transition: transform 0.2s ease-out;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	.sheet-backdrop.open .sheet {
		transform: translateY(0);
	}

	.sheet-handle {
		width: 32px;
		height: 4px;
		background: var(--border-default);
		border-radius: 2px;
		margin: 0.75rem auto 0;
		flex-shrink: 0;
	}

	.sheet-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		flex-shrink: 0;
	}

	.sheet-titles {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}

	.sheet-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
	}

	.sheet-subtitle {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sheet-close {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
		transition: color 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.sheet-close:hover {
		color: var(--text-primary);
	}

	.sheet-content {
		overflow-y: auto;
		padding: 0 1rem 1rem;
		flex: 1;
		min-height: 0;
	}

	.revisions-list {
		display: flex;
		flex-direction: column;
	}

	.revision-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.revision-row:last-child {
		border-bottom: none;
	}

	.revision-icon {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		background: var(--bg-tertiary);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.revision-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}

	.revision-format {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.revision-meta {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.restore-btn {
		flex-shrink: 0;
		padding: 0.375rem 0.75rem;
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--accent);
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.15s;
	}

	.restore-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.sheet-empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-align: center;
		padding: 2rem 1rem;
	}

	.sheet-empty.error {
		color: #ef4444;
	}

	.sheet-loading {
		display: flex;
		flex-direction: column;
	}

	.revision-skeleton {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.25rem;
	}

	.icon-skeleton {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-hover) 50%, var(--bg-tertiary) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	.text-skeleton-stack {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		flex: 1;
	}

	.text-skeleton {
		height: 12px;
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-hover) 50%, var(--bg-tertiary) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	.text-skeleton.wide {
		width: 70%;
	}

	.text-skeleton.narrow {
		width: 45%;
	}

	.btn-skeleton {
		width: 64px;
		height: 28px;
		border-radius: var(--radius-md);
		background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-hover) 50%, var(--bg-tertiary) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (min-width: 600px) {
		.sheet-backdrop {
			align-items: center;
		}

		.sheet {
			border-radius: var(--radius-xl);
			border-bottom: 1px solid var(--border-subtle);
			max-width: 480px;
			max-height: 70vh;
			transform: scale(0.95);
			opacity: 0;
			transition: transform 0.2s ease-out, opacity 0.15s;
		}

		.sheet-backdrop.open .sheet {
			transform: scale(1);
			opacity: 1;
		}

		.sheet-handle {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.icon-skeleton,
		.text-skeleton,
		.btn-skeleton {
			animation: none;
		}
		.sheet {
			transition: none;
		}
		.sheet-backdrop {
			transition: none;
		}
	}
</style>
