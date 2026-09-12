<script lang="ts">
	import type { PublishingDefaults } from '$lib/publishing';

	interface Props {
		value: PublishingDefaults;
		showSpace?: boolean;
		showRights?: boolean;
		disabled?: boolean;
	}
	let {
		value = $bindable(),
		showSpace = false,
		showRights = false,
		disabled = false
	}: Props = $props();

	function listening(next: PublishingDefaults['access']['listening']): void {
		value = {
			...value,
			access: {
				...value.access,
				listening: next,
				downloads: next === 'space' ? 'off' : value.access.downloads,
				visibility:
					next === 'space'
						? 'private'
						: value.access.visibility === 'private'
							? 'unlisted'
							: value.access.visibility
			},
			attach_rights: next === 'space' ? false : value.attach_rights
		};
	}
</script>

<fieldset {disabled} class="publishing-controls">
	<legend class="sr-only">music access</legend>
	<label class="choice">
		<input
			type="checkbox"
			checked={value.access.listening === 'public'}
			onchange={(event) => listening(event.currentTarget.checked ? 'public' : 'owner')}
		/>
		<span>anyone can listen</span>
	</label>
	{#if value.access.listening !== 'public'}
		<label class="audience"
			>who can listen?
			<select
				value={value.access.listening}
				onchange={(event) => {
					const selected = event.currentTarget.value;
					if (
						selected === 'owner' ||
						selected === 'signed_in' ||
						selected === 'supporters' ||
						selected === 'space'
					)
						listening(selected);
				}}
			>
				<option value="owner">only me</option>
				<option value="signed_in">signed-in listeners</option>
				<option value="supporters">verified supporters</option>
				{#if showSpace || value.access.listening === 'space'}<option
						value="space"
						disabled={!showSpace}>my Space members</option
					>{/if}
			</select>
		</label>
	{/if}
	<label class="choice">
		<input
			type="checkbox"
			disabled={value.access.listening === 'space'}
			checked={value.access.downloads === 'open' || value.access.downloads === 'ask'}
			onchange={(event) =>
				(value = {
					...value,
					access: { ...value.access, downloads: event.currentTarget.checked ? 'open' : 'off' }
				})}
		/>
		<span>anyone can download</span>
	</label>
	{#if value.access.listening !== 'space' && (value.access.downloads === 'off' || value.access.downloads === 'supporters')}
		<label class="audience"
			>who can download?
			<select
				value={value.access.downloads}
				onchange={(event) => {
					const downloads = event.currentTarget.value;
					if (downloads === 'off' || downloads === 'supporters')
						value = { ...value, access: { ...value.access, downloads } };
				}}
			>
				<option value="off">only me</option>
				<option value="supporters">verified supporters</option>
			</select>
		</label>
		<p>people who can listen can still save or record playback.</p>
	{/if}
	{#if value.access.listening === 'space'}
		<p>
			only people admitted by your Space can see or play this work. direct file downloads from
			Spaces are not available yet.
		</p>
	{/if}
	{#if showRights && value.access.listening !== 'space'}
		<label class="choice"
			><input
				type="checkbox"
				checked={value.attach_rights}
				onchange={(event) => (value = { ...value, attach_rights: event.currentTarget.checked })}
			/><span>attach rights information</span></label
		>
		{#if value.attach_rights}<p>
				uses your rights setup in Portal. credits and licensing do not change who can listen or
				download.
			</p>{/if}
	{/if}
	{#if value.access.listening !== 'space'}
		<details>
			<summary>more options</summary>
			{#if value.access.visibility !== 'private'}
				<label class="choice"
					><input
						type="checkbox"
						checked={value.access.visibility === 'public'}
						onchange={(event) =>
							(value = {
								...value,
								access: {
									...value.access,
									visibility: event.currentTarget.checked ? 'public' : 'unlisted'
								}
							})}
					/><span>show in feeds</span></label
				>
				<p>when off, this can still appear on your profile, in albums, playlists and search.</p>
			{/if}
			{#if value.access.downloads === 'open' || value.access.downloads === 'ask'}
				<label class="choice"
					><input
						type="checkbox"
						checked={value.access.downloads === 'ask'}
						onchange={(event) =>
							(value = {
								...value,
								access: { ...value.access, downloads: event.currentTarget.checked ? 'ask' : 'open' }
							})}
					/><span>ask for support before downloading</span></label
				>
				<p>a request, not a payment requirement.</p>
			{/if}
		</details>
	{/if}
</fieldset>

<style>
	.publishing-controls {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.85rem;
		min-width: 0;
	}
	.choice {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		cursor: pointer;
	}
	input {
		accent-color: var(--accent);
	}
	.audience {
		display: grid;
		gap: 0.4rem;
		padding-left: 1.7rem;
		font-size: var(--text-sm);
	}
	select {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		padding: 0.65rem;
		font: inherit;
		width: 100%;
	}
	p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
	summary {
		cursor: pointer;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	details[open] {
		display: grid;
		gap: 0.75rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
