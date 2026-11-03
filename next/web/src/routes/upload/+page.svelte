<script lang="ts">
	import { trackIdFromUri } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { audioDuration, MAX_AUDIO_BYTES, uploadTrack } from '$lib/pds';
	import type { Gate } from '$lib/spaces';

	let file = $state<File | null>(null);
	let title = $state('');
	let artist = $state('');
	let album = $state('');
	let description = $state('');
	let duration = $state<number | undefined>(undefined);
	let gate = $state<Gate | ''>('');
	let busy = $state(false);
	let note = $state<string | null>(null);

	$effect(() => {
		if (!artist && auth.handle) artist = auth.handle;
	});

	async function pick(e: Event) {
		const picked = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		file = picked;
		duration = undefined;
		note = null;
		if (!picked) return;
		if (!title) title = picked.name.replace(/\.[^.]+$/, '');
		if (picked.size > MAX_AUDIO_BYTES) note = 'that file is over the 100 MB limit';
		duration = await audioDuration(picked);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!file) return;
		busy = true;
		note = 'uploading to your PDS…';
		try {
			const { uri, status } = await uploadTrack({ file, title, artist, album, description, duration, gate: gate || null });
			if (status === 'indexed') location.href = `/track/${trackIdFromUri(uri)}`;
			else if (status === 'rejected') note = 'saved to your PDS, but the appview rejected the record';
			else note = 'saved to your PDS; still indexing, it will show up shortly';
		} catch (err) {
			note = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h1>upload</h1>
{#if !auth.ready}
	<p class="muted">loading…</p>
{:else if !auth.did}
	<p class="muted"><a href="/login">sign in</a> to upload.</p>
{:else}
	<p class="muted">the audio is stored on your own PDS; next.plyr.fm only indexes the record.</p>
	<form onsubmit={submit}>
		<label>audio <input type="file" accept="audio/*" onchange={pick} required /></label>
		<label>title <input bind:value={title} maxlength="256" required /></label>
		<label>artist <input bind:value={artist} maxlength="256" required /></label>
		<label>album <input bind:value={album} maxlength="256" /></label>
		<label>description <textarea bind:value={description} maxlength="5000" rows="4"></textarea></label>
		{#if auth.spaces}
			<label
				>who can listen
				<select bind:value={gate}>
					<option value="">everyone</option>
					<option value="supporters">supporters only</option>
					<option value="signed-in">anyone signed in</option>
				</select>
			</label>
			{#if gate}<p class="muted small">the audio goes into a private space on your PDS; plyr only decides who gets in.</p>{/if}
		{:else}
			<p class="muted small">supporter-only tracks need a PDS with spaces; yours doesn't have them yet.</p>
		{/if}
		<button class="btn" disabled={busy || !file || !title.trim() || !artist.trim()}>upload</button>
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
	.small {
		font-size: 0.8rem;
		margin: 0;
	}
</style>
