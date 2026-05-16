<script lang="ts">
	import { API_URL, COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
	import { auth } from '$lib/auth.svelte';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';

	// hide the panel entirely for users without the feature flag. parents
	// (upload page, edit form) keep rendering normally — they just see no
	// copyright section in the form.
	const flagEnabled = $derived(
		auth.user?.enabled_flags?.includes(COPYRIGHT_PARADIGM_FLAG) ?? false
	);

	export type TrackRights = {
		iswc?: string;
		isrc?: string;
		masterOwner?: { name: string; did?: string } | null;
		// co-writer / publisher editing is a follow-up; for now the user is the only
		// interestedParty (auto-derived backend-side from their portal config)
	};

	type CopyrightConfig = {
		paradigm: string;
		paradigm_data: Record<string, string> | null;
	};

	type Props = {
		enabled: boolean;
		rights: TrackRights;
		disabled?: boolean;
	};

	let {
		enabled = $bindable(),
		rights = $bindable(),
		disabled = false
	}: Props = $props();

	let config = $state<CopyrightConfig | null>(null);
	let configLoaded = $state(false);

	$effect(() => {
		(async () => {
			try {
				const r = await fetch(`${API_URL}/copyright/config`, { credentials: 'include' });
				if (r.ok) config = (await r.json()) as CopyrightConfig | null;
			} catch (e) {
				console.error('failed to load copyright config:', e);
			} finally {
				configLoaded = true;
			}
		})();
	});

	const ownerSummary = $derived.by(() => {
		const data = config?.paradigm_data;
		if (!data) return null;
		return (
			data.companyName ??
			[data.firstName, data.lastName].filter(Boolean).join(' ') ??
			null
		);
	});

	let masterOwnerName = $state(rights.masterOwner?.name ?? '');

	function syncMasterOwner() {
		const name = masterOwnerName.trim();
		rights = {
			...rights,
			masterOwner: name ? { name } : null
		};
	}

	// format patterns mirror the backend's pydantic validators
	// (ch_indiemusi/models.py). client-side checks give immediate feedback;
	// the backend still rejects anything that slips through.
	const iswcError = $derived.by(() => {
		const v = (rights.iswc ?? '').trim();
		if (!v) return null;
		return /^T-?\d{9}-?\d$/.test(v)
			? null
			: 'ISWC should look like T-330690274-5 (T + 9 digits + check digit)';
	});

	const isrcError = $derived.by(() => {
		const v = (rights.isrc ?? '').trim();
		if (!v) return null;
		return /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(v)
			? null
			: 'ISRC should look like CHD542500009 — uppercase, 12 chars, no hyphens';
	});
</script>

{#if flagEnabled}
<div class="rights-panel" class:disabled>
	<label class="enable-row">
		<input
			type="checkbox"
			bind:checked={enabled}
			disabled={disabled || !config}
		/>
		<span>this is a copyrighted work</span>
	</label>

	{#if !configLoaded}
		<p class="hint">loading…</p>
	{:else if !config}
		<p class="hint missing-config">
			set up copyright in
			<a href="/portal">your portal</a>
			before flagging tracks as copyrighted.
		</p>
	{:else if enabled}
		{#if ownerSummary}
			<p class="hint owner-line">
				rights credited to <strong>{ownerSummary}</strong>
			</p>
		{/if}

		<div class="grid-2">
			<div class="form-group">
				<label for="copyright-rights-iswc">
					ISWC (optional)
					<InfoTooltip label="what's an ISWC?">
						International Standard Musical Work Code — uniquely identifies the
						song (the composition). assigned when a song is registered with a
						collecting society.
					</InfoTooltip>
				</label>
				<input
					id="copyright-rights-iswc"
					type="text"
					maxlength="13"
					placeholder="e.g. T-330690274-5"
					value={rights.iswc ?? ''}
					oninput={(e) => (rights = { ...rights, iswc: (e.currentTarget as HTMLInputElement).value })}
					{disabled}
					aria-invalid={iswcError ? 'true' : undefined}
					aria-describedby={iswcError ? 'copyright-rights-iswc-error' : undefined}
				/>
				{#if iswcError}
					<p class="field-error" id="copyright-rights-iswc-error">{iswcError}</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="copyright-rights-isrc">
					ISRC (optional)
					<InfoTooltip label="what's an ISRC?">
						International Standard Recording Code — uniquely identifies a
						specific recording (this performance, not the song). issued by your
						label or distributor.
					</InfoTooltip>
				</label>
				<input
					id="copyright-rights-isrc"
					type="text"
					maxlength="12"
					placeholder="e.g. CHD542500009"
					value={rights.isrc ?? ''}
					oninput={(e) => (rights = { ...rights, isrc: (e.currentTarget as HTMLInputElement).value })}
					{disabled}
					aria-invalid={isrcError ? 'true' : undefined}
					aria-describedby={isrcError ? 'copyright-rights-isrc-error' : undefined}
				/>
				{#if isrcError}
					<p class="field-error" id="copyright-rights-isrc-error">{isrcError}</p>
				{/if}
			</div>
		</div>

		<div class="form-group">
			<label for="copyright-rights-master">
				master owner (optional)
				<InfoTooltip label="what's a master owner?">
					who owns this specific recording (the "master"), separate from the
					song itself. usually the artist for self-released work, or the label
					if you're signed.
				</InfoTooltip>
			</label>
			<input
				id="copyright-rights-master"
				type="text"
				maxlength="255"
				placeholder="who owns the recording"
				bind:value={masterOwnerName}
				oninput={syncMasterOwner}
				{disabled}
			/>
			<p class="hint">leave blank if you own your own masters</p>
		</div>

		<p class="hint storage-note">
			audio for copyrighted works is stored privately — it won't be published as a
			public PDS blob and requires sign-in to stream.
		</p>
	{/if}
</div>
{/if}

<style>
	.rights-panel {
		margin: 1rem 0;
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.rights-panel.disabled {
		opacity: 0.7;
	}

	.enable-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-base);
		color: var(--text-primary);
		cursor: pointer;
		margin-bottom: 0.5rem;
	}

	.enable-row input[type='checkbox'] {
		cursor: pointer;
	}

	.hint {
		margin: 0.5rem 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
		line-height: 1.4;
	}

	.hint a {
		color: var(--accent);
		text-decoration: none;
	}

	.hint a:hover {
		text-decoration: underline;
	}

	.missing-config {
		color: var(--text-tertiary);
	}

	.owner-line {
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	.storage-note {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 600px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}

	.form-group {
		margin-bottom: 0.75rem;
	}

	.form-group label {
		display: block;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin-bottom: 0.35rem;
	}

	.form-group input {
		width: 100%;
		padding: 0.55rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
	}

	.form-group input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.form-group input[aria-invalid='true'] {
		border-color: var(--danger, #e5484d);
	}

	.field-error {
		margin: 0.35rem 0 0;
		font-size: var(--text-xs);
		color: var(--danger, #e5484d);
	}

	.form-group input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
