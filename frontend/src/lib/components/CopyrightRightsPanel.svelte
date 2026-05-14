<script lang="ts">
	import { API_URL } from '$lib/config';

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
</script>

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
			set up a copyright paradigm in
			<a href="/portal">your portal</a>
			before flagging tracks as copyrighted.
		</p>
	{:else if enabled}
		<p class="hint paradigm-row">
			using <strong>{config.paradigm}</strong>
			{#if ownerSummary}· primary owner: <strong>{ownerSummary}</strong>{/if}
		</p>

		<div class="grid-2">
			<div class="form-group">
				<label for="copyright-rights-iswc">ISWC (optional)</label>
				<input
					id="copyright-rights-iswc"
					type="text"
					maxlength="13"
					placeholder="e.g. T-330690274-5"
					value={rights.iswc ?? ''}
					oninput={(e) => (rights = { ...rights, iswc: (e.currentTarget as HTMLInputElement).value })}
					{disabled}
				/>
				<p class="hint">composition code from your collecting society</p>
			</div>

			<div class="form-group">
				<label for="copyright-rights-isrc">ISRC (optional)</label>
				<input
					id="copyright-rights-isrc"
					type="text"
					maxlength="12"
					placeholder="e.g. CHD542500009"
					value={rights.isrc ?? ''}
					oninput={(e) => (rights = { ...rights, isrc: (e.currentTarget as HTMLInputElement).value })}
					{disabled}
				/>
				<p class="hint">recording code</p>
			</div>
		</div>

		<div class="form-group">
			<label for="copyright-rights-master">master owner (optional)</label>
			<input
				id="copyright-rights-master"
				type="text"
				maxlength="255"
				placeholder="who owns the recording"
				bind:value={masterOwnerName}
				oninput={syncMasterOwner}
				{disabled}
			/>
			<p class="hint">
				leave blank if you own your own masters (we'll fill it in for you)
			</p>
		</div>

		<p class="hint storage-note">
			audio for copyrighted works is stored privately — it won't be published as a
			public PDS blob and requires sign-in to stream.
		</p>
	{/if}
</div>

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

	.paradigm-row {
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

	.form-group input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
