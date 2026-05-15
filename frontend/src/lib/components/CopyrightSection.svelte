<script lang="ts">
	import { API_URL, COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import InfoTooltip from '$lib/components/InfoTooltip.svelte';

	// hide the entire section for users who don't have the copyright-paradigm
	// feature flag. backend endpoints 404 for unflagged users too, so even a
	// devtools poke wouldn't see anything useful.
	const flagEnabled = $derived(
		auth.user?.enabled_flags?.includes(COPYRIGHT_PARADIGM_FLAG) ?? false
	);

	// shape mirrors PublishingOwnerInput on the backend (camelCase aliases)
	type PublishingOwnerValue = {
		$type?: string;
		ipi?: string;
		firstName?: string;
		lastName?: string;
		companyName?: string;
		collectingSociety?: string;
		// preserved-but-unknown fields may live here in the raw value too
		[key: string]: unknown;
	};

	type PublishingOwnerRecord = {
		uri: string;
		rkey: string;
		cid: string | null;
		value: PublishingOwnerValue;
		in_use: boolean;
	};

	type ListResponse = {
		records: PublishingOwnerRecord[];
		needs_scope_upgrade: boolean;
	};

	type OpResponse = {
		auth_url: string | null;
		complete: boolean;
		uri: string | null;
	};

	type OwnerKind = 'individual' | 'company';

	type EditingState =
		| { mode: 'none' }
		| { mode: 'create' }
		| { mode: 'edit'; rkey: string; uri: string };

	let loading = $state(true);
	let records = $state<PublishingOwnerRecord[]>([]);
	let needsScopeUpgrade = $state(false);

	let editing = $state<EditingState>({ mode: 'none' });
	let saving = $state(false);
	let pendingRkey = $state<string | null>(null); // for use/delete spinners

	// form state — bound only while editing.mode != 'none'
	let ownerKind = $state<OwnerKind>('individual');
	let ipi = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let companyName = $state('');
	let collectingSociety = $state('');

	const ipiError = $derived.by(() => {
		const v = ipi.trim();
		if (!v) return null;
		return /^\d{11}$/.test(v) ? null : 'IPI must be exactly 11 digits';
	});

	const canSubmit = $derived(
		!ipiError &&
			editing.mode !== 'none' &&
			((ownerKind === 'individual' &&
				firstName.trim() !== '' &&
				lastName.trim() !== '') ||
				(ownerKind === 'company' && companyName.trim() !== ''))
	);

	async function fetchList() {
		loading = true;
		try {
			const res = await fetch(`${API_URL}/copyright/publishing-owners`, {
				credentials: 'include'
			});
			if (!res.ok) throw new Error(`list failed (${res.status})`);
			const data = (await res.json()) as ListResponse;
			records = data.records;
			needsScopeUpgrade = data.needs_scope_upgrade;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'failed to load owner records';
			toast.error(msg);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (flagEnabled) fetchList();
	});

	function resetForm() {
		ownerKind = 'individual';
		ipi = '';
		firstName = '';
		lastName = '';
		companyName = '';
		collectingSociety = '';
	}

	function prefillFromValue(v: PublishingOwnerValue) {
		ownerKind = v.companyName ? 'company' : 'individual';
		ipi = v.ipi ?? '';
		firstName = v.firstName ?? '';
		lastName = v.lastName ?? '';
		companyName = v.companyName ?? '';
		collectingSociety = v.collectingSociety ?? '';
	}

	function openCreate() {
		resetForm();
		editing = { mode: 'create' };
	}

	function openEdit(record: PublishingOwnerRecord) {
		prefillFromValue(record.value);
		editing = { mode: 'edit', rkey: record.rkey, uri: record.uri };
	}

	function cancelEditing() {
		editing = { mode: 'none' };
		resetForm();
	}

	function buildPayload(): PublishingOwnerValue {
		const out: PublishingOwnerValue = {};
		const ipiT = ipi.trim();
		const socT = collectingSociety.trim();
		if (ipiT) out.ipi = ipiT;
		if (socT) out.collectingSociety = socT;
		if (ownerKind === 'individual') {
			out.firstName = firstName.trim();
			out.lastName = lastName.trim();
		} else {
			out.companyName = companyName.trim();
		}
		return out;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || saving || editing.mode === 'none') return;
		saving = true;
		try {
			const body = JSON.stringify({ publishing_owner: buildPayload() });
			const url =
				editing.mode === 'create'
					? `${API_URL}/copyright/publishing-owners`
					: `${API_URL}/copyright/publishing-owners/${editing.rkey}`;
			const method = editing.mode === 'create' ? 'POST' : 'PUT';
			const res = await fetch(url, {
				method,
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body
			});
			if (!res.ok) {
				let message = `${editing.mode} failed (${res.status})`;
				try {
					const errBody = await res.json();
					if (errBody?.detail) message = String(errBody.detail);
				} catch {
					// ignore json parse errors
				}
				throw new Error(message);
			}
			const data = (await res.json()) as OpResponse;
			if (data.auth_url) {
				window.location.href = data.auth_url;
				return;
			}
			toast.success(editing.mode === 'create' ? 'owner record created' : 'owner record updated');
			editing = { mode: 'none' };
			resetForm();
			await fetchList();
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'save failed';
			toast.error(msg);
		} finally {
			saving = false;
		}
	}

	async function handleUse(record: PublishingOwnerRecord) {
		if (pendingRkey) return;
		pendingRkey = record.rkey;
		try {
			const res = await fetch(`${API_URL}/copyright/use-owner`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ uri: record.uri })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.detail ?? `use failed (${res.status})`);
			}
			toast.success('now using this owner record');
			await fetchList();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'use failed');
		} finally {
			pendingRkey = null;
		}
	}

	async function handleDelete(record: PublishingOwnerRecord) {
		if (pendingRkey) return;
		const ownerLabel = summaryFor(record.value) ?? record.rkey;
		if (!confirm(`delete the owner record for "${ownerLabel}"? this removes it from your PDS.`)) {
			return;
		}
		pendingRkey = record.rkey;
		try {
			const res = await fetch(
				`${API_URL}/copyright/publishing-owners/${record.rkey}`,
				{ method: 'DELETE', credentials: 'include' }
			);
			if (res.status === 412) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.detail ?? 'grant write access first');
				return;
			}
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.detail ?? `delete failed (${res.status})`);
			}
			toast.success('owner record deleted');
			await fetchList();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'delete failed');
		} finally {
			pendingRkey = null;
		}
	}

	function summaryFor(v: PublishingOwnerValue): string | null {
		if (v.companyName) return v.companyName;
		const name = [v.firstName, v.lastName].filter(Boolean).join(' ');
		return name || null;
	}

	const hasRecords = $derived(records.length > 0);
</script>

{#if flagEnabled}
<section class="copyright-section">
	<div class="section-header">
		<h2>copyright</h2>
	</div>

	{#if loading}
		<p class="loading-text">loading…</p>
	{:else}
		{#if !hasRecords && editing.mode !== 'create'}
			<p class="explainer">
				publish copyright info to your PDS so other ATProto music apps can show
				who owns what. uses
				<a href="https://indiemusi.ch" target="_blank" rel="noopener">indiemusi.ch</a>'s
				open schema for rights metadata.
			</p>
		{/if}

		{#if hasRecords}
			<ul class="owner-list">
				{#each records as record (record.rkey)}
					{@const ownerName = summaryFor(record.value)}
					<li class="owner-card" class:in-use={record.in_use}>
						<div class="owner-summary">
							<div class="owner-name">
								{ownerName ?? '(unnamed)'}
								{#if record.in_use}<span class="in-use-badge">in use</span>{/if}
							</div>
							<div class="owner-meta">
								{#if record.value.ipi}<span>IPI {record.value.ipi}</span>{/if}
								{#if record.value.collectingSociety}<span>· {record.value.collectingSociety}</span>{/if}
							</div>
						</div>
						<div class="owner-actions">
							<button
								type="button"
								class="row-btn"
								onclick={() => openEdit(record)}
								disabled={saving || pendingRkey !== null}
							>
								edit
							</button>
							{#if !record.in_use}
								<button
									type="button"
									class="row-btn primary"
									onclick={() => handleUse(record)}
									disabled={saving || pendingRkey !== null}
								>
									{pendingRkey === record.rkey ? 'switching…' : 'use this'}
								</button>
							{/if}
							<button
								type="button"
								class="row-btn danger"
								onclick={() => handleDelete(record)}
								disabled={saving || pendingRkey !== null}
								title="delete this record from your PDS"
							>
								delete
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if needsScopeUpgrade && editing.mode === 'none'}
			<p class="hint scope-banner">
				plyr.fm doesn't yet have write access to your owner records. it'll prompt
				for it the next time you try to create or edit one.
			</p>
		{/if}

		{#if editing.mode !== 'none'}
			<form onsubmit={handleSubmit}>
				<div class="form-header">
					{editing.mode === 'create' ? 'new owner record' : 'edit owner record'}
				</div>

				<div class="form-group" role="group" aria-labelledby="owner-kind-label">
					<span id="owner-kind-label" class="form-label">
						publishing owner
						<InfoTooltip label="what's a publishing owner?">
							the person or company that holds the copyright to the song — the
							melody, lyrics, and arrangement.
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
							behalf. ASCAP and BMI in the US, Suisa in Switzerland, PRS in the UK.
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
					<button type="button" class="cancel-link" onclick={cancelEditing} disabled={saving}>
						cancel
					</button>
					<button type="submit" disabled={!canSubmit || saving}>
						{saving ? 'saving…' : 'save'}
					</button>
				</div>
			</form>
		{:else}
			<button type="button" class="new-btn" onclick={openCreate}>+ new owner record</button>
		{/if}

		{#if hasRecords}
			<p class="footnote">
				records are stored on your PDS using <a href="https://indiemusi.ch" target="_blank" rel="noopener">indiemusi.ch</a>'s
				open schema.
			</p>
		{/if}
	{/if}
</section>
{/if}

<style>
	.copyright-section {
		margin-bottom: 2rem;
	}

	.section-header {
		margin-bottom: 1rem;
	}

	.section-header h2 {
		margin: 0;
	}

	.loading-text {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 0;
	}

	.explainer {
		margin: 0 0 1rem;
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

	.owner-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.owner-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}

	.owner-card.in-use {
		border-color: var(--accent);
	}

	.owner-summary {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.owner-name {
		font-weight: 600;
		color: var(--text-primary);
		font-size: var(--text-base);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.in-use-badge {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--accent);
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
	}

	.owner-meta {
		display: flex;
		gap: 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		flex-wrap: wrap;
	}

	.owner-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.row-btn {
		padding: 0.4rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
	}

	.row-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.row-btn.primary {
		background: var(--accent);
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.row-btn.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.row-btn.danger:hover:not(:disabled) {
		border-color: var(--danger, #e5484d);
		color: var(--danger, #e5484d);
	}

	.row-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.new-btn {
		display: block;
		width: fit-content;
		padding: 0.6rem 1.1rem;
		background: transparent;
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
	}

	.new-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.scope-banner {
		margin: 0 0 1rem;
		padding: 0.6rem 0.85rem;
		background: var(--bg-tertiary);
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		font-size: var(--text-xs);
	}

	form {
		background: var(--bg-tertiary);
		padding: 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.form-header {
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 1rem;
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
	}

	form button[type='submit']:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	form button[type='submit']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.footnote {
		margin: 1rem 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.footnote a {
		color: var(--accent);
		text-decoration: none;
	}

	.footnote a:hover {
		text-decoration: underline;
	}
</style>
