<script lang="ts">
	import { audioAccept } from '$lib/media/accept';
	import { onMount, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PrivateCreate, PrivateResult } from '@plyr/next-core/publishing/private-music';
	import { auth } from '$lib/auth';
	import { privateMusic } from '$lib/private-library';
	import { canonicalAudioFile } from '$lib/media/audio-file';
	import { fileDuration } from '$lib/media/file-duration';
	import Loading from '$lib/ui/Loading.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { api } from '$lib/api';
	import { creditName } from '@plyr/next-core/publishing/credit-name';

	let { account, selected, busy = $bindable(false), audio = $bindable(), title = $bindable(''), description = $bindable(''), tags = $bindable(''), visibility }: {
		account: ReturnType<typeof auth.getAuth>; selected: boolean; busy: boolean; audio: File | undefined; title: string; description: string; tags: string; visibility?: Snippet;
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
	let profileName = $state('');
	const artist = $derived(profileName || account.handle || '');
	let attempt: string | undefined;
	const active = $derived(pending.some(operation => !operation.archived));
	let fileInput = $state<HTMLInputElement>();

	onMount(() => {
		live = true;
		void refresh();
		if (account.did) void api.artist(account.did).then(profile => { if (current()) profileName = creditName(profile.display_name) ?? ''; }, () => {});
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
		description = '';
		tags = '';
		if (fileInput) fileInput.value = '';
	}

	function upload() {
		const file = audio;
		if (!selected || !file || active) return;
		const input = { file, title, artist, description, tags: tags.split('\n') };
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
				if (current() && audio === file && title === input.title && description === input.description && tags === input.tags.join('\n')) reset(result.operation);
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
			<div class="card">
				<div class="file">
					<span class="file-icon"><Icon name="lock" size={20} /></span>
					<span class="file-text">
						<b>{audio ? audio.name : 'a private track'}</b>
						<small>only you can play it, from your library. up to 100 MB.</small>
					</span>
					<label class="pick"><input id="private-audio" type="file" accept={audioAccept()} bind:this={fileInput} disabled={busy || active} onchange={event => {
						const file = event.currentTarget.files?.[0];
						audio = file ? canonicalAudioFile(file) : undefined;
						if (audio && !title) title = audio.name.replace(/\.[^.]+$/, '').slice(0, 256);
					}} /><span>{audio ? 'change audio' : 'choose audio'}</span></label>
				</div>
				<label class="field"><span>title</span><input id="private-title" bind:value={title} maxlength="256" required disabled={busy || active} placeholder="name this track" /></label>
				<label class="field"><span>description</span><textarea id="private-description" bind:value={description} maxlength="5000" rows="3" disabled={busy || active} placeholder="notes to yourself…"></textarea></label>
				<label class="field"><span>tags</span><textarea id="private-tags" bind:value={tags} placeholder="one tag per line" rows="2" disabled={busy || active}></textarea></label>
			</div>
			<div class="bar">
				{@render visibility?.()}
				<span class="hint">only you can play it</span>
				<button class="submit" type="submit" disabled={busy || active || loading || !!recoveryError || !audio || !title.trim()}>
					<Icon name="upload" size={18} />{busy ? 'saving…' : 'upload'}
				</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.recovery, .card { background: var(--surface); border: 1px solid var(--line); padding: 1.1rem; border-radius: 0.9rem; }
	.recovery { margin-bottom: 0.8rem; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
	.card { display: grid; gap: 1rem; }
	.file { display: flex; align-items: center; gap: 0.85rem; }
	.file-icon { width: 3rem; height: 3rem; flex: none; display: grid; place-items: center; border-radius: 0.7rem; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
	.file-text { flex: 1; min-width: 0; display: grid; overflow-wrap: anywhere; }
	.file-text small { color: var(--faint); font-size: 0.85rem; }
	.pick { position: relative; flex: none; display: inline-flex; align-items: center; min-height: 2.5rem; padding: 0 1rem; border-radius: 999px; background: var(--raised); font-weight: 700; font-size: 0.9rem; cursor: pointer; }
	.pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.pick:focus-within { outline: 2px solid var(--accent); outline-offset: 3px; }
	.field { display: grid; gap: 0.4rem; }
	.field > span { font-size: 0.8rem; font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
	.field :is(input, textarea) { width: 100%; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); padding: 0.65rem 0.8rem; }
	.bar { position: sticky; bottom: calc(1rem + var(--bar-offset, 0px)); z-index: 3; display: flex; align-items: center; gap: 1rem; padding: 0.5rem 0.5rem 0.5rem 0.75rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.14); }
	.hint { flex: 1; text-align: right; color: var(--faint); font-size: 0.85rem; }
	.submit { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 3rem; padding: 0 1.75rem; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 1.02rem; }
	@media (max-width: 720px) {
		.file { flex-wrap: wrap; }
		.bar { gap: 0.5rem; padding: 0.4rem; }
		.hint { display: none; }
		.submit { flex: 1; min-width: 0; padding: 0 1rem; justify-content: center; }
	}
</style>
