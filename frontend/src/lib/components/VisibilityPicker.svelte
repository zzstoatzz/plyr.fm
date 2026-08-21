<script lang="ts">
	/**
	 * The one "visibility & access" choice, shared by /upload and /record so
	 * both surfaces describe the same options in the same words.
	 */
	export type Visibility = 'public' | 'unlisted' | 'supporters' | 'private';

	interface Props {
		/** the selected visibility. */
		visibility: Visibility;
		/** when set, offer "supporters only" and link to this atprotofans page. */
		supportUrl?: string | null;
		/** offer "private" — only meaningful on a spaces-capable PDS. */
		showPrivate?: boolean;
		/** show "private" but refuse it, with `privateNote` saying why. */
		privateDisabled?: boolean;
		/** replaces the default private explanation (e.g. a format that can't be private). */
		privateNote?: string | null;
		/** whether the session already holds the private-media grant. */
		privateGranted?: boolean;
		/** disable everything except public/unlisted (copyright metadata is attached). */
		restrictedToPublic?: boolean;
	}

	let {
		visibility = $bindable(),
		supportUrl = null,
		showPrivate = false,
		privateDisabled = false,
		privateNote = null,
		privateGranted = false,
		restrictedToPublic = false
	}: Props = $props();

	const defaultPrivateNote = $derived(
		privateGranted
			? 'stored in a permissioned space on your PDS — no public copy, hidden from feeds, playable only by you.'
			: "stored in a permissioned space on your PDS — no public copy, hidden from feeds, playable only by you. you'll be asked once to approve access."
	);
</script>

<fieldset class="access-card">
	<legend>visibility &amp; access</legend>

	<label class="access-row">
		<input type="radio" bind:group={visibility} value="public" />
		<span class="access-body">
			<span class="access-title">public</span>
			<span class="access-note">appears in feeds; anyone can play it.</span>
		</span>
	</label>

	<label class="access-row">
		<input type="radio" bind:group={visibility} value="unlisted" />
		<span class="access-body">
			<span class="access-title">unlisted</span>
			<span class="access-note">
				hidden from feeds, but anyone with the link, your profile, albums, playlists,
				or search can play it.
			</span>
		</span>
	</label>

	{#if supportUrl}
		<label class="access-row" class:unavailable={restrictedToPublic}>
			<input
				type="radio"
				bind:group={visibility}
				value="supporters"
				disabled={restrictedToPublic}
			/>
			<span class="access-body">
				<span class="access-title">
					<svg class="row-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
					</svg>
					supporters only
				</span>
				<span class="access-note">
					only users who support you via
					<a href={supportUrl} target="_blank" rel="noopener">atprotofans</a> can play it.
				</span>
			</span>
		</label>
	{/if}

	{#if showPrivate}
		<label class="access-row" class:unavailable={privateDisabled || restrictedToPublic}>
			<input
				type="radio"
				bind:group={visibility}
				value="private"
				disabled={privateDisabled || restrictedToPublic}
			/>
			<span class="access-body">
				<span class="access-title">
					<svg class="row-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="3" y="11" width="18" height="11" rx="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
					private
				</span>
				<span class="access-note">{privateNote ?? defaultPrivateNote}</span>
			</span>
		</label>
	{/if}
</fieldset>

<style>
	.access-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		min-width: 0;
	}

	.access-card legend {
		margin-left: 0.75rem;
		padding: 0 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.access-row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.875rem 1rem;
		margin: 0;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.access-row:hover {
		background: color-mix(in srgb, var(--accent) 5%, transparent);
	}

	.access-row + .access-row {
		border-top: 1px solid var(--border-default);
	}

	.access-row.unavailable {
		cursor: not-allowed;
	}

	.access-row.unavailable .access-title {
		color: var(--text-muted);
	}

	.access-row input[type='radio'] {
		margin-top: 0.2rem;
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: inherit;
	}

	.access-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.access-title {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-primary);
	}

	.row-icon {
		color: var(--accent);
	}

	.access-note {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		line-height: 1.45;
	}

	.access-note a {
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.access-row {
			transition: none;
		}
	}
</style>
