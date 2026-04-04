<script lang="ts" module>
	import type { FeaturedArtist, Artist } from '$lib/types';

	export interface TrackEntry {
		id: string;
		file: File | null;
		title: string;
		description: string;
		tags: string[];
		featuredArtists: FeaturedArtist[];
		hasUnresolvedFeaturesInput: boolean;
		autoTag: boolean;
		supportGated: boolean;
		status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
		error: string | null;
	}
</script>

<script lang="ts">
	import TagInput from '$lib/components/TagInput.svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';

	const FILE_INPUT_ACCEPT =
		'.mp3,.wav,.m4a,.aiff,.aif,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aiff,audio/x-aiff,audio/flac';

	interface Props {
		entry: TrackEntry;
		index: number;
		expanded: boolean;
		artistProfile: Artist | null;
		disabled?: boolean;
		onUpdate: (field: string, value: any) => void;
		onRemove: () => void;
		onToggle: () => void;
		onFileChange: (file: File) => void;
	}

	let {
		entry,
		index,
		expanded,
		artistProfile,
		disabled = false,
		onUpdate,
		onRemove,
		onToggle,
		onFileChange,
	}: Props = $props();

	function handleFileInput(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			onFileChange(target.files[0]);
		}
	}

	let displayName = $derived(
		entry.file?.name ?? 'no file selected'
	);

	let statusIcon = $derived.by(() => {
		switch (entry.status) {
			case 'uploading':
			case 'processing':
				return 'spinner';
			case 'completed':
				return 'check';
			case 'failed':
				return 'error';
			default:
				return null;
		}
	});
</script>

<div class="track-card" class:expanded class:has-error={entry.status === 'failed'}>
	<button
		type="button"
		class="track-header"
		onclick={onToggle}
		aria-expanded={expanded}
	>
		<span class="chevron" class:rotated={expanded}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M9 18l6-6-6-6" />
			</svg>
		</span>

		<span class="track-summary">
			<span class="track-number">#{index + 1}</span>
			<span class="separator">&middot;</span>
			<span class="track-filename">{displayName}</span>
			{#if entry.title}
				<span class="separator">&middot;</span>
				<span class="track-title">{entry.title}</span>
			{/if}
		</span>

		{#if statusIcon === 'spinner'}
			<span class="status-indicator uploading">
				<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
				</svg>
				{entry.status}
			</span>
		{:else if statusIcon === 'check'}
			<span class="status-indicator completed">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M20 6L9 17l-5-5" />
				</svg>
				completed
			</span>
		{:else if statusIcon === 'error'}
			<span class="status-indicator failed">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
				failed
			</span>
		{/if}
	</button>

	{#if entry.status === 'failed' && entry.error && !expanded}
		<div class="error-banner">{entry.error}</div>
	{/if}

	{#if expanded}
		<div class="track-body">
			<div class="form-group">
				<label for="file-{entry.id}">audio file</label>
				<input
					id="file-{entry.id}"
					type="file"
					accept={FILE_INPUT_ACCEPT}
					onchange={handleFileInput}
					{disabled}
				/>
				{#if entry.file}
					<p class="file-info">
						{entry.file.name} ({(entry.file.size / 1024 / 1024).toFixed(2)} MB)
					</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="title-{entry.id}">title</label>
				<input
					id="title-{entry.id}"
					type="text"
					value={entry.title}
					oninput={(e) => onUpdate('title', (e.target as HTMLInputElement).value)}
					required
					maxlength="256"
					placeholder="track title"
					{disabled}
				/>
			</div>

			<div class="form-group">
				<label for="description-{entry.id}">description (optional)</label>
				<textarea
					id="description-{entry.id}"
					value={entry.description}
					oninput={(e) => onUpdate('description', (e.target as HTMLTextAreaElement).value)}
					placeholder="liner notes, show notes, credits..."
					rows="3"
					maxlength="5000"
					{disabled}
				></textarea>
				{#if entry.description.length > 0}
					<div class="char-count">{entry.description.length} / 5000</div>
				{/if}
			</div>

			<div class="form-group">
				<label for="tags-{entry.id}">tags (optional)</label>
				<TagInput
					tags={entry.tags}
					onAdd={(tag) => onUpdate('tags', [...entry.tags, tag])}
					onRemove={(tag) => onUpdate('tags', entry.tags.filter((t) => t !== tag))}
					placeholder="type to search tags..."
					{disabled}
				/>
				<label class="checkbox-label" style="margin-top: 0.75rem;">
					<input
						type="checkbox"
						checked={entry.autoTag}
						onchange={(e) => onUpdate('autoTag', (e.target as HTMLInputElement).checked)}
						{disabled}
					/>
					<span class="checkbox-text">auto-tag with recommended genres</span>
					<InfoTooltip label="auto-tagging info">
						ML genre classification suggests tags from your audio.
						<a href="https://docs.plyr.fm/artists/#auto-tagging" target="_blank" rel="noopener">learn more</a>
					</InfoTooltip>
				</label>
			</div>

			<div class="form-group">
				<label for="features-{entry.id}">featured artists (optional)</label>
				<HandleSearch
					selected={entry.featuredArtists}
					hasUnresolvedInput={entry.hasUnresolvedFeaturesInput}
					onAdd={(artist) => onUpdate('featuredArtists', [...entry.featuredArtists, artist])}
					onRemove={(did) => onUpdate('featuredArtists', entry.featuredArtists.filter((a) => a.did !== did))}
					{disabled}
				/>
			</div>

			{#if artistProfile?.support_url}
				<div class="form-group supporter-gating">
					<label class="checkbox-label">
						<input
							type="checkbox"
							checked={entry.supportGated}
							onchange={(e) => onUpdate('supportGated', (e.target as HTMLInputElement).checked)}
							{disabled}
						/>
						<span class="checkbox-text">
							<svg class="heart-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
							</svg>
							supporters only
						</span>
					</label>
					<p class="gating-note">
						only users who support you via <a href={artistProfile.support_url} target="_blank" rel="noopener">atprotofans</a> can play this track
					</p>
				</div>
			{/if}

			{#if entry.status === 'failed' && entry.error}
				<div class="error-banner">{entry.error}</div>
			{/if}

			<button
				type="button"
				class="remove-btn"
				onclick={onRemove}
				{disabled}
			>
				remove track
			</button>
		</div>
	{/if}
</div>

<style>
	.track-card {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.track-card.has-error {
		border-color: var(--error);
	}

	.track-card.expanded {
		border-color: var(--border-default);
	}

	.track-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}

	.track-header:hover {
		background: var(--bg-hover);
	}

	.chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--text-tertiary);
		transition: transform 0.2s ease;
		transform: rotate(0deg);
	}

	.chevron.rotated {
		transform: rotate(90deg);
	}

	.track-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.track-number {
		font-weight: 600;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.separator {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.track-filename {
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.track-title {
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: var(--text-sm);
		font-weight: 500;
		flex-shrink: 0;
	}

	.status-indicator.uploading {
		color: var(--accent);
	}

	.status-indicator.completed {
		color: var(--success);
	}

	.status-indicator.failed {
		color: var(--error);
	}

	.spin {
		animation: spin 1.2s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.error-banner {
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--error) 10%, transparent);
		color: var(--error);
		font-size: var(--text-sm);
		border-top: 1px solid color-mix(in srgb, var(--error) 20%, transparent);
	}

	.track-body {
		padding: 1rem 1rem 1.25rem;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.form-group {
		margin-bottom: 1.25rem;
	}

	.form-group label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		font-size: var(--text-base);
	}

	.form-group input[type="text"] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-lg);
		font-family: inherit;
		transition: all 0.2s;
	}

	.form-group input[type="text"]:focus {
		outline: none;
		border-color: var(--accent);
	}

	.form-group input[type="text"]:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.form-group textarea {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.2s;
		resize: vertical;
		min-height: 4rem;
	}

	.form-group textarea:focus {
		outline: none;
		border-color: var(--accent);
	}

	.form-group textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.form-group input[type="file"] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		cursor: pointer;
	}

	.form-group input[type="file"]:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}

	.checkbox-label {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		cursor: pointer;
		margin-bottom: 0;
	}

	.checkbox-label input[type="checkbox"] {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.1rem;
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"]:disabled {
		cursor: not-allowed;
	}

	.checkbox-text {
		font-size: var(--text-base);
		color: var(--text-primary);
		line-height: 1.4;
	}

	.supporter-gating {
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
		padding: 1rem;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border-default));
	}

	.supporter-gating .checkbox-text {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.supporter-gating .heart-icon {
		color: var(--accent);
	}

	.gating-note {
		margin-top: 0.5rem;
		margin-left: 2rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.gating-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.gating-note a:hover {
		text-decoration: underline;
	}

	.remove-btn {
		align-self: flex-start;
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		color: var(--error);
		font-size: var(--text-sm);
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.remove-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.remove-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.track-header {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.track-body {
			padding: 0.75rem;
		}

		.track-summary {
			font-size: var(--text-sm);
		}

		.form-group input[type="text"],
		.form-group textarea {
			font-size: 16px; /* prevents zoom on iOS */
		}
	}
</style>
