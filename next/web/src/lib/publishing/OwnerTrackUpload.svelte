<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PrivateCreate, PrivateResult } from '@plyr/next-core/publishing/private-music';
	import { auth } from '$lib/auth';
	import { privateMusic } from '$lib/private-library';
	import { canonicalAudioFile } from '$lib/media/audio-file';
	import { fileDuration } from '$lib/media/file-duration';
	import Loading from '$lib/ui/Loading.svelte';

	let { account, selected, busy = $bindable(false), audio = $bindable(), title = $bindable(''), description = $bindable(''), tags = $bindable('') }: {
		account: ReturnType<typeof auth.getAuth>; selected: boolean; busy: boolean; audio: File | undefined; title: string; description: string; tags: string;
	} = $props();
	const pds = $derived(privateMusic(account));
	let live = false;
	let generation = 0;
	const current = () => live && auth.getAuth().rpc === account.rpc && auth.getAuth().did === account.did;
	let pending = $state.raw<PrivateCreate[]>([]);
	let results = $state<Record<string, PrivateResult>>({});
	let loading = $state(true);
	let recoveryError = $state('');
	let feedback = $state('');
	let artist = $state('');
	let attempt: string | undefined;
	const active = $derived(pending.some(operation => !operation.archived));
	let fileInput = $state<HTMLInputElement>();

	onMount(() => {
		live = true;
		void refresh();
		return () => { live = false; generation++; };
	});

	async function refresh() {
		const version = ++generation;
		const [operations] = await Promise.allSettled([pds.pending()]);
		if (!current() || version !== generation) return;
		if (operations.status === 'fulfilled') {
			pending = operations.value;
			recoveryError = '';
		} else {
			recoveryError = 'could not check earlier uploads. try again before uploading.';
		}
		loading = false;
	}

	async function run(action: () => Promise<void>, reload = true) {
		if (!current() || busy) return;
		busy = true;
		feedback = '';
		try { await action(); }
		catch (error) { if (current()) feedback = error instanceof Error ? error.message : 'could not save this track.'; }
		finally {
			if (current()) {
				if (reload) await refresh();
				busy = false;
			}
		}
	}

	function reset(operation: PrivateCreate) {
		if (!current() || attempt !== operation.rkey) return;
		attempt = undefined;
		audio = undefined;
		title = '';
		artist = '';
		description = '';
		tags = '';
		if (fileInput) fileInput.value = '';
	}

	function upload() {
		const file = audio;
		if (!selected || !file || active) return;
		const input = { file, title, artist: artist.trim() || account.handle || '', description, tags: tags.split('\n') };
		void run(async () => {
			const duration = await fileDuration(file);
			if (!current()) return;
			const result = await pds.upload({
				...input, duration
			}, operation => { if (current()) attempt = operation.rkey; });
			if (!current()) return;
			results[result.operation.rkey] = result.result;
			if (result.result.state === 'accepted') {
				await pds.dismiss(result.operation);
				if (current() && selected) reset(result.operation);
				if (current() && selected) await goto(resolve('/(app)/portal'));
			}
		});
	}

</script>

<div class="form">
	{#if feedback}<p class="state" role="status">{feedback}</p>{/if}
	{#if loading}<Loading label="loading upload drafts" inline />{/if}
	{#if recoveryError}
		<p role="status" class="state">{recoveryError}</p>
		<button type="button" class="text-button" disabled={busy} onclick={() => run(refresh, false)}>try again</button>
	{/if}
	{#each pending as operation (operation.rkey)}
		<section class="recovery">
			<h2>{typeof operation.record.title === 'string' ? operation.record.title : 'track upload'}</h2>
			<p class="subtle">
				{results[operation.rkey]?.state === 'accepted' ? 'track saved.' : operation.archived ? 'this earlier upload might still finish.' : 'this track may already be saved. check its status before trying again.'}
			</p>
			<button class="text-button" disabled={busy} onclick={() => run(async () => {
				const result = await pds.recover(operation);
				if (current()) results[operation.rkey] = result;
			})}>check upload status</button>
			{#if results[operation.rkey]?.state === 'accepted' || results[operation.rkey]?.state === 'different'}
				<button class="text-button" disabled={busy} onclick={() => run(async () => {
					await pds.dismiss(operation, results[operation.rkey]?.state === 'different');
					reset(operation);
					if (selected && results[operation.rkey]?.state === 'accepted') await goto(resolve('/(app)/portal'));
				})}>{results[operation.rkey]?.state === 'different' ? 'keep existing track' : 'done with upload'}</button>
			{:else}
				<button class="text-button" disabled={busy} onclick={() => run(async () => {
					const result = await pds.recover(operation, true);
					if (current()) results[operation.rkey] = result;
				})}>retry upload</button>
				{#if !operation.archived}<button class="text-button" disabled={busy} onclick={() => run(async () => { await pds.archive(operation, true); reset(operation); })}>set aside upload</button>{/if}
			{/if}
		</section>
	{/each}


	{#if !account.privatePublishing}
		<a class="text-button" href={resolve('/login?return_to=%2Fupload%3Fvisibility%3Donly-you')}>sign in again to upload</a>
	{:else}
		<form onsubmit={event => { event.preventDefault(); upload(); }}>
			<label for="private-audio">audio</label>
			<input id="private-audio" type="file" accept="audio/*" bind:this={fileInput} disabled={busy || active} onchange={event => {
				const file = event.currentTarget.files?.[0];
				audio = file ? canonicalAudioFile(file) : undefined;
				if (audio && !title) title = audio.name.replace(/\.[^.]+$/, '').slice(0, 256);
			}} />
			<p class="subtle">{audio ? audio.name + ' · ' : ''}up to 100 MiB</p>
			<label for="private-title">title</label>
			<input id="private-title" bind:value={title} maxlength="256" required disabled={busy || active} />
			<label for="private-artist">artist</label>
			<input id="private-artist" bind:value={artist} maxlength="256" placeholder={account.handle ?? ''} disabled={busy || active} />
			<label for="private-description">description</label>
			<textarea id="private-description" bind:value={description} maxlength="5000" rows="3" disabled={busy || active}></textarea>
			<label for="private-tags">tags</label>
			<textarea id="private-tags" bind:value={tags} placeholder="one tag per line" rows="2" disabled={busy || active}></textarea>
			<button class="text-button submit" type="submit" disabled={busy || active || loading || !!recoveryError || !audio || !title.trim()}>
				{busy ? 'saving…' : 'upload'}
			</button>
		</form>
	{/if}
</div>

<style>
	.recovery, form { background: var(--surface); border: 1px solid var(--line); padding: 1rem; border-radius: 0.8rem; }
	.recovery { margin-bottom: 0.8rem; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	form { display: grid; gap: 0.6rem; }
	label { font-weight: 600; }
	input, textarea { width: 100%; border: 1px solid var(--line); border-radius: 0.55rem; background: var(--bg); padding: 0.6rem; }
	.submit { color: var(--on-accent); background: var(--accent); justify-self: start; padding-inline: 1.25rem; }
</style>
