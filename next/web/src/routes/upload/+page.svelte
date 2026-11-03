<script lang="ts">
	import Loading from '$lib/ui/Loading.svelte';
	import { trackIdFromUri } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { GATED_UPLOADS } from '$lib/config';
	import { audioDuration, MAX_AUDIO_BYTES, uploadTrack } from '$lib/pds';
	import type { Gate } from '$lib/spaces';
	import { formatDuration } from '$lib/player.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ArtworkPicker from '$lib/ArtworkPicker.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';

	let file = $state<File | null>(null);
	let title = $state('');
	let artist = $state('');
	let album = $state('');
	let description = $state('');
	let duration = $state<number | undefined>(undefined);
	let gate = $state<Gate | ''>('');
	let artwork = $state<File | null | undefined>(undefined);
	let busy = $state(false);
	let note = $state<string | null>(null);
	/** once the PDS has the record, it's saved: never create it again on retry */
	let saved = $state<{ uri: string; status: string } | null>(null);

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
		if (!file || busy || saved) return;
		busy = true;
		note = 'uploading to your PDS…';
		try {
			const { uri, status } = await uploadTrack({ file, title, artist, album, description, duration, artwork, gate: gate || null });
			saved = { uri, status };
			note = null;
			if (status === 'indexed') location.href = `/track/${trackIdFromUri(uri)}`;
		} catch (err) {
			note = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<ScreenHeader title="upload" subtitle="audio is stored on your own PDS" />

{#if !auth.ready}
	<Loading />
{:else if !auth.did}
	<div class="empty">
		<p>sign in to upload.</p>
		<a class="btn primary" href="/login">sign in</a>
	</div>
{:else}
	{#if saved}
		<div class="saved pad" role="status">
			<strong>saved to your PDS</strong>
			<p class="hint">
				{saved.status === 'rejected'
					? "the appview didn't accept the record, so it won't show up here yet. it's still in your repo."
					: "it's still being indexed and will show up shortly. nothing else to do."}
			</p>
			<div class="row">
				<a class="btn outline" href="/track/{trackIdFromUri(saved.uri)}">view track</a>
				<button
					class="btn"
					onclick={() => {
						saved = null;
						file = null;
						title = album = description = '';
						artwork = undefined;
						duration = undefined;
					}}>upload another</button
				>
			</div>
		</div>
	{:else}
	<form class="pad" onsubmit={submit}>
		<label class="drop" class:has={!!file}>
			<input type="file" accept="audio/*" onchange={pick} required />
			<Icon name={file ? 'music' : 'upload'} size={28} />
			{#if file}
				<strong class="ellipsis">{file.name}</strong>
				<span class="muted small">{(file.size / 1_048_576).toFixed(1)} MB{#if duration}{' · '}{formatDuration(duration)}{/if} · tap to change</span>
			{:else}
				<strong>choose an audio file</strong>
				<span class="muted small">up to 100 MB</span>
			{/if}
		</label>
		<label class="field"><span>title</span><input bind:value={title} maxlength="256" required /></label>
		<label class="field"><span>artist</span><input bind:value={artist} maxlength="256" required /></label>
		<label class="field"><span>album <em>(optional)</em></span><input bind:value={album} maxlength="256" /></label>
		<label class="field"><span>description <em>(optional)</em></span><textarea bind:value={description} maxlength="5000"></textarea></label>
		<div class="field">
			<span>cover art <em>(optional)</em></span>
			<ArtworkPicker bind:value={artwork} seed={title} />
		</div>
		{#if auth.spaces}
			<label class="field">
				<span>who can listen</span>
				<select bind:value={gate}>
					<option value="">everyone</option>
					<option value="supporters">supporters only</option>
					<option value="signed-in">anyone signed in</option>
				</select>
				{#if gate}<span class="hint">the audio goes into a private space on your PDS; plyr only decides who gets in.</span>{/if}
			</label>
		{:else if GATED_UPLOADS}
			<p class="hint">supporter-only tracks need a PDS with spaces; yours doesn't have them yet.</p>
		{/if}
		<button class="btn primary block lg" disabled={busy || !file || !title.trim() || !artist.trim()}>{busy ? 'uploading…' : 'upload'}</button>
		{#if note}<p class="hint note" role="status">{note}</p>{/if}
	</form>
	{/if}
{/if}

<style>
	.drop {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-xs);
		padding: var(--s-2xl) var(--s-lg);
		margin-bottom: var(--s-lg);
		border: 1.5px dashed var(--c-200);
		border-radius: var(--r-lg);
		text-align: center;
		cursor: pointer;
		color: var(--c-700);
		max-width: 100%;
	}
	.drop:focus-within {
		border-color: var(--accent);
		background: var(--c-25);
	}
	@media (hover: hover) {
		.drop:hover {
			border-color: var(--accent);
			background: var(--c-25);
		}
	}
	.drop.has {
		border-style: solid;
	}
	.drop strong {
		color: var(--c-1000);
		max-width: 100%;
	}
	.drop input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	em {
		font-style: normal;
		font-weight: 400;
		color: var(--c-500);
	}
	.note {
		margin-top: var(--s-md);
		text-align: center;
	}
	.saved {
		display: flex;
		flex-direction: column;
		gap: var(--s-sm);
		text-align: center;
		align-items: center;
		padding-top: var(--s-4xl);
	}
	.saved .row {
		display: flex;
		gap: var(--s-sm);
	}
	.empty .btn {
		margin-top: var(--s-md);
	}
</style>
