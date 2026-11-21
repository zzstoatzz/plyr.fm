<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PrivateCreate, PrivateResult } from '@plyr/next-core/publishing/private-music';
	import { auth } from '$lib/auth';
	import { privateMusic } from '$lib/private-library';
	import { fileDuration } from '$lib/media/file-duration';
	import Loading from '$lib/ui/Loading.svelte';

	// "only you" uploads: closed with no ways in, kept in the artist's private
	// library. the upload form hands its track here; this shows earlier
	// attempts that may still need settling.
	let { account, busy = $bindable(false), blocked = $bindable(false) }: {
		account: ReturnType<typeof auth.getAuth>; busy: boolean;
		/** an earlier private upload must be settled before another one starts */
		blocked: boolean;
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
	$effect(() => { blocked = loading || !!recoveryError || pending.some(operation => !operation.archived); });

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
			recoveryError = 'could not check earlier private uploads. try again before uploading.';
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

	/** save a track to the private library; resolves true once the PDS has it. errors throw so the form keeps what was typed */
	export async function save(input: { file: File; artwork?: File; title: string; artist: string; description: string; tags: string[] }): Promise<boolean> {
		if (!current() || busy || blocked) return false;
		busy = true;
		try {
			const duration = await fileDuration(input.file);
			if (!current()) return false;
			const result = await pds.upload({ ...input, duration }, () => {});
			if (!current()) return false;
			results[result.operation.rkey] = result.result;
			if (result.result.state !== 'accepted') throw new Error('this track may already be saved. check its status below before trying again.');
			await pds.dismiss(result.operation);
			return true;
		} finally {
			if (current()) {
				await refresh();
				busy = false;
			}
		}
	}
</script>

{#if feedback}<p class="state" role="status">{feedback}</p>{/if}
{#if loading && account.privatePublishing}<Loading label="checking earlier private uploads" inline />{/if}
{#if recoveryError}
	<p role="status" class="state">{recoveryError}</p>
	<button type="button" class="text-button" disabled={busy} onclick={() => run(refresh, false)}>try again</button>
{/if}
{#each pending as operation (operation.rkey)}
	<section class="recovery">
		<h2>{typeof operation.record.title === 'string' ? operation.record.title : 'track upload'} <small>only you</small></h2>
		<p class="subtle">
			{results[operation.rkey]?.state === 'accepted' ? 'track saved.' : operation.archived ? 'this earlier upload might still finish.' : 'this track may already be saved. check its status before trying again.'}
		</p>
		<button class="text-button" disabled={busy} onclick={() => run(async () => {
			const result = await pds.recover(operation);
			if (current()) results[operation.rkey] = result;
		})}>check upload status</button>
		{#if results[operation.rkey]?.state === 'accepted' || results[operation.rkey]?.state === 'different'}
			<button class="text-button" disabled={busy} onclick={() => run(async () => {
				const accepted = results[operation.rkey]?.state === 'accepted';
				await pds.dismiss(operation, results[operation.rkey]?.state === 'different');
				if (accepted) await goto(resolve('/(app)/portal'));
			})}>{results[operation.rkey]?.state === 'different' ? 'keep existing track' : 'done with upload'}</button>
		{:else}
			<button class="text-button" disabled={busy} onclick={() => run(async () => {
				const result = await pds.recover(operation, true);
				if (current()) results[operation.rkey] = result;
			})}>retry upload</button>
			{#if !operation.archived}<button class="text-button" disabled={busy} onclick={() => run(async () => { await pds.archive(operation, true); })}>set aside upload</button>{/if}
		{/if}
	</section>
{/each}

<style>
	.recovery { background: var(--surface); border: 1px solid var(--line); padding: 1.1rem; border-radius: 0.9rem; }
	h2 { font-size: 1rem; overflow-wrap: anywhere; }
	h2 small { margin-left: 0.4rem; color: var(--faint); font-size: 0.8rem; font-weight: 600; }
	.subtle { color: var(--muted); }
</style>
