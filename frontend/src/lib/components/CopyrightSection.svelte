<script lang="ts">
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';

	type PublishingOwner = {
		ipi?: string;
		firstName?: string;
		lastName?: string;
		companyName?: string;
		collectingSociety?: string;
	};

	type CopyrightConfig = {
		paradigm: string;
		config_uri: string | null;
		paradigm_data: PublishingOwner | null;
	};

	type OwnerKind = 'individual' | 'company';

	let loading = $state(true);
	let saving = $state(false);
	let config = $state<CopyrightConfig | null>(null);
	let expanded = $state(false);

	let ownerKind = $state<OwnerKind>('individual');
	let ipi = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let companyName = $state('');
	let collectingSociety = $state('');

	// IPI Name Number — CISAC spec, exactly 11 digits (leading zeros included).
	// matches the backend pattern in ch_indiemusi/models.py.
	const ipiError = $derived.by(() => {
		const v = ipi.trim();
		if (!v) return null;
		return /^\d{11}$/.test(v) ? null : 'IPI must be exactly 11 digits';
	});

	const canSubmit = $derived(
		!ipiError &&
			((ownerKind === 'individual' &&
				firstName.trim() !== '' &&
				lastName.trim() !== '') ||
				(ownerKind === 'company' && companyName.trim() !== ''))
	);

	async function fetchConfig() {
		loading = true;
		try {
			const res = await fetch(`${API_URL}/copyright/config`, {
				credentials: 'include'
			});
			if (!res.ok) throw new Error(`failed to load config (${res.status})`);
			const data = (await res.json()) as CopyrightConfig | null;
			config = data;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'failed to load copyright config';
			toast.error(message);
		} finally {
			loading = false;
		}
	}

	function resetForm() {
		ownerKind = 'individual';
		ipi = '';
		firstName = '';
		lastName = '';
		companyName = '';
		collectingSociety = '';
	}

	function prefillFromConfig(data: PublishingOwner | null) {
		resetForm();
		if (!data) return;
		ownerKind = data.companyName ? 'company' : 'individual';
		ipi = data.ipi ?? '';
		firstName = data.firstName ?? '';
		lastName = data.lastName ?? '';
		companyName = data.companyName ?? '';
		collectingSociety = data.collectingSociety ?? '';
	}

	function openSetupForm() {
		resetForm();
		expanded = true;
	}

	function openEditForm() {
		prefillFromConfig(config?.paradigm_data ?? null);
		expanded = true;
	}

	function cancelForm() {
		expanded = false;
		resetForm();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || saving) return;

		const publishing_owner: PublishingOwner = {};
		const ipiTrimmed = ipi.trim();
		const collectingTrimmed = collectingSociety.trim();
		if (ipiTrimmed) publishing_owner.ipi = ipiTrimmed;
		if (collectingTrimmed) publishing_owner.collectingSociety = collectingTrimmed;
		if (ownerKind === 'individual') {
			publishing_owner.firstName = firstName.trim();
			publishing_owner.lastName = lastName.trim();
		} else {
			publishing_owner.companyName = companyName.trim();
		}

		saving = true;
		try {
			const res = await fetch(`${API_URL}/copyright/setup`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					paradigm: 'indiemusi-alpha',
					publishing_owner
				})
			});
			if (!res.ok) {
				let message = `setup failed (${res.status})`;
				try {
					const errBody = await res.json();
					if (errBody?.detail) message = String(errBody.detail);
				} catch {
					// ignore json parse errors
				}
				throw new Error(message);
			}
			const data = (await res.json()) as { auth_url: string | null; complete: boolean };
			if (data.auth_url) {
				window.location.href = data.auth_url;
				return;
			}
			if (data.complete) {
				toast.success('copyright paradigm configured');
				expanded = false;
				await fetchConfig();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'failed to set up copyright paradigm';
			toast.error(message);
		} finally {
			saving = false;
		}
	}

	async function handleDisconnect() {
		if (saving) return;
		saving = true;
		try {
			const res = await fetch(`${API_URL}/copyright/disconnect`, {
				method: 'POST',
				credentials: 'include'
			});
			if (res.status === 409) {
				// disconnect blocked: the user still has copyright-gated tracks.
				// surface the count + a hint about clearing them in the edit form.
				const body = await res.json().catch(() => null);
				const message =
					body?.detail?.message ??
					'disconnect blocked: clear copyright metadata from your tracks first';
				toast.error(message, 7000);
				return;
			}
			if (!res.ok) throw new Error(`disconnect failed (${res.status})`);
			toast.success('copyright paradigm disconnected');
			config = null;
			expanded = false;
			resetForm();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'failed to disconnect';
			toast.error(message);
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		fetchConfig();
	});
</script>

<section class="copyright-section">
	<div class="section-header">
		<h2>copyright</h2>
	</div>

	{#if loading}
		<p class="loading-text">loading…</p>
	{:else if config && !expanded}
		<div class="config-summary">
			<div class="summary-info">
				{#if config.paradigm_data?.companyName}
					<div class="summary-row"><span class="summary-label">company</span> {config.paradigm_data.companyName}</div>
				{:else if config.paradigm_data?.firstName || config.paradigm_data?.lastName}
					<div class="summary-row">
						<span class="summary-label">owner</span>
						{[config.paradigm_data.firstName, config.paradigm_data.lastName].filter(Boolean).join(' ')}
					</div>
				{/if}
				{#if config.paradigm_data?.ipi}
					<div class="summary-row"><span class="summary-label">IPI</span> {config.paradigm_data.ipi}</div>
				{/if}
				{#if config.paradigm_data?.collectingSociety}
					<div class="summary-row">
						<span class="summary-label">collecting society</span> {config.paradigm_data.collectingSociety}
					</div>
				{/if}
				<div class="summary-footnote">
					published via <a href="https://indiemusi.ch" target="_blank" rel="noopener">indiemusi.ch</a>'s rights schema
				</div>
			</div>
			<div class="summary-actions">
				<button type="button" class="edit-btn" onclick={openEditForm} disabled={saving}>edit</button>
				<button type="button" class="disconnect-btn" onclick={handleDisconnect} disabled={saving}>
					{saving ? 'disconnecting…' : 'disconnect'}
				</button>
			</div>
		</div>
	{:else if !config && !expanded}
		<div class="setup-prompt">
			<p class="explainer">
				publish copyright info to your PDS so other ATProto music apps can show
				who owns what. uses <a href="https://indiemusi.ch" target="_blank" rel="noopener">indiemusi.ch</a>'s
				open schema for rights metadata.
			</p>
			<button type="button" class="setup-btn" onclick={openSetupForm}>set up copyright</button>
		</div>
	{:else}
		<form onsubmit={handleSubmit}>
			<div class="form-group" role="group" aria-labelledby="owner-kind-label">
				<span id="owner-kind-label" class="form-label">
					publishing owner
					<InfoTooltip label="what's a publishing owner?">
						the person or company that holds the copyright to the song — the melody,
						lyrics, and arrangement. self-published songwriters are their own
						publishing owner.
					</InfoTooltip>
				</span>
				<div class="owner-kind-options">
					<label class="owner-kind-option">
						<input
							type="radio"
							name="owner-kind"
							value="individual"
							bind:group={ownerKind}
							disabled={saving}
						/>
						<span>individual</span>
					</label>
					<label class="owner-kind-option">
						<input
							type="radio"
							name="owner-kind"
							value="company"
							bind:group={ownerKind}
							disabled={saving}
						/>
						<span>company</span>
					</label>
				</div>
			</div>

			{#if ownerKind === 'individual'}
				<div class="form-group">
					<label for="copyright-first-name">first name</label>
					<input
						id="copyright-first-name"
						type="text"
						bind:value={firstName}
						disabled={saving}
						maxlength="255"
						placeholder="first name"
					/>
				</div>
				<div class="form-group">
					<label for="copyright-last-name">last name</label>
					<input
						id="copyright-last-name"
						type="text"
						bind:value={lastName}
						disabled={saving}
						maxlength="255"
						placeholder="last name"
					/>
				</div>
			{:else}
				<div class="form-group">
					<label for="copyright-company">company name</label>
					<input
						id="copyright-company"
						type="text"
						bind:value={companyName}
						disabled={saving}
						maxlength="255"
						placeholder="company name"
					/>
				</div>
			{/if}

			<div class="form-group">
				<label for="copyright-ipi">
					IPI (optional)
					<InfoTooltip label="what's an IPI?">
						Interested Party Information — an international ID assigned by a
						collecting society. you probably only have one if you've registered
						with a society like ASCAP, BMI, or Suisa.
					</InfoTooltip>
				</label>
				<input
					id="copyright-ipi"
					type="text"
					inputmode="numeric"
					pattern="[0-9]*"
					bind:value={ipi}
					disabled={saving}
					maxlength="11"
					placeholder="e.g. 00012345678"
					aria-invalid={ipiError ? 'true' : undefined}
					aria-describedby={ipiError ? 'copyright-ipi-error' : undefined}
				/>
				{#if ipiError}
					<p class="field-error" id="copyright-ipi-error">{ipiError}</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="copyright-society">
					collecting society (optional)
					<InfoTooltip label="what's a collecting society?">
						the organization that collects and distributes royalties on your
						behalf. ASCAP and BMI in the US, Suisa in Switzerland, PRS in the UK,
						GEMA in Germany.
					</InfoTooltip>
				</label>
				<input
					id="copyright-society"
					type="text"
					bind:value={collectingSociety}
					disabled={saving}
					maxlength="255"
					placeholder="ASCAP, BMI, Suisa, PRS, …"
				/>
			</div>

			<div class="form-actions">
				<button type="button" class="cancel-link" onclick={cancelForm} disabled={saving}>cancel</button>
				<button type="submit" disabled={!canSubmit || saving}>
					{saving ? 'saving…' : config ? 'save changes' : 'save'}
				</button>
			</div>
		</form>
	{/if}
</section>

<style>
	.copyright-section {
		margin-bottom: 2rem;
	}

	.copyright-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.loading-text {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 0;
	}

	.setup-prompt {
		background: var(--bg-tertiary);
		padding: 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.explainer {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	.explainer a {
		color: var(--accent);
		text-decoration: none;
	}

	.explainer a:hover {
		text-decoration: underline;
	}

	.setup-btn {
		align-self: flex-start;
		padding: 0.6rem 1.1rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		color: var(--accent);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.setup-btn:hover {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.config-summary {
		background: var(--bg-tertiary);
		padding: 1rem 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.summary-info {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.summary-row {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.summary-label {
		color: var(--text-muted);
		margin-right: 0.4rem;
	}

	.summary-footnote {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-top: 0.35rem;
	}

	.summary-footnote a {
		color: var(--accent);
		text-decoration: none;
	}

	.summary-footnote a:hover {
		text-decoration: underline;
	}

	.summary-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.edit-btn,
	.disconnect-btn {
		padding: 0.45rem 0.85rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.edit-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.disconnect-btn:hover:not(:disabled) {
		border-color: var(--danger, #e5484d);
		color: var(--danger, #e5484d);
	}

	.edit-btn:disabled,
	.disconnect-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	form {
		background: var(--bg-tertiary);
		padding: 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-of-type {
		margin-bottom: 1.25rem;
	}

	label,
	.form-label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.4rem;
		font-size: var(--text-sm);
	}

	input[type='text'] {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type='text'][aria-invalid='true'] {
		border-color: var(--danger, #e5484d);
	}

	.field-error {
		margin-top: 0.35rem;
		font-size: var(--text-xs);
		color: var(--danger, #e5484d);
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.owner-kind-options {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.owner-kind-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.85rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin-bottom: 0;
	}

	.owner-kind-option input[type='radio'] {
		margin: 0;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.75rem;
	}

	.cancel-link {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 0.5rem 0.25rem;
	}

	.cancel-link:hover:not(:disabled) {
		color: var(--text-secondary);
		text-decoration: underline;
	}

	.cancel-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	form button[type='submit'] {
		padding: 0.6rem 1.25rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	form button[type='submit']:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	form button[type='submit']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
