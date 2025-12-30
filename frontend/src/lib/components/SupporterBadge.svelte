<script lang="ts">
	/**
	 * displays a badge indicating the viewer supports the artist via atprotofans.
	 * only shown when the logged-in user has validated supporter status.
	 */
</script>

<span class="supporter-badge" title="you support this artist via atprotofans">
	<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
		/>
	</svg>
	<span class="label">supporter</span>
</span>

<style>
	.supporter-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.5rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius-sm);
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 500;
		text-transform: lowercase;
		white-space: nowrap;
	}

	.supporter-badge svg {
		flex-shrink: 0;
	}

	.label {
		line-height: 1;
	}
</style>
