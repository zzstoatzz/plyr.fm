<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { myProfile, saveProfile, type ProfileRecord } from '$lib/pds';

	let current = $state<{ value: ProfileRecord | null; cid: string | null } | null>(null);
	let bio = $state('');
	let avatar = $state('');
	let busy = $state(false);
	let note = $state<string | null>(null);
	let loadedFor: string | null = null;

	$effect(() => {
		const did = auth.did;
		if (!did || loadedFor === did) return;
		loadedFor = did;
		load();
	});

	async function load() {
		note = null;
		try {
			current = await myProfile();
			bio = current.value?.bio ?? '';
			avatar = current.value?.avatar ?? '';
		} catch (err) {
			note = (err as Error).message;
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!current) return;
		if (avatar.trim() && !avatar.trim().startsWith('https://')) {
			note = 'avatar has to be an https:// url';
			return;
		}
		busy = true;
		note = 'saving to your PDS…';
		try {
			const status = await saveProfile({ bio, avatar }, current);
			note =
				status === 'indexed'
					? 'saved.'
					: status === 'rejected'
						? 'saved to your PDS, but the appview rejected the record'
						: 'saved to your PDS; still indexing';
			await load();
		} catch (err) {
			note = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h1>profile</h1>
{#if !auth.ready}
	<p class="muted">loading…</p>
{:else if !auth.did}
	<p class="muted"><a href="/login">sign in</a> to edit your profile.</p>
{:else if !current}
	<p class="muted">{note ?? 'loading…'}</p>
{:else}
	<p class="muted">
		this is your plyr profile record on your own PDS. your name and handle come from your bluesky profile.
	</p>
	<form onsubmit={submit}>
		<label>bio <textarea bind:value={bio} maxlength="256" rows="4"></textarea></label>
		<label>avatar url <input bind:value={avatar} type="url" placeholder="https://…" /></label>
		<button disabled={busy}>{busy ? 'saving…' : 'save'}</button>
	</form>
	{#if note}<p class="muted">{note}</p>{/if}
{/if}

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 32rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	button {
		align-self: flex-start;
	}
</style>
