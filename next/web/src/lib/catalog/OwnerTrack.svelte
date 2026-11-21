<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { Track } from '@plyr/next-core/api';
	import { auth } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import { privateMusic } from '$lib/private-library';
	import Loading from '$lib/ui/Loading.svelte';
	import TrackDetail from './TrackDetail.svelte';

	let { account, rkey }: { account: ReturnType<typeof auth.getAuth>; rkey: string } = $props();
	const pds = $derived(privateMusic(account));
	let track = $state.raw<Track>();
	let loading = $state(true);
	let problem = $state('');
	let removal = $state<'confirm' | 'uncertain'>();
	let busy = $state(false);
	let uploadPending = $state(false);
	let siblings: Promise<Track[]> | undefined;
	let live = false;
	const current = () => live && auth.getAuth().rpc === account.rpc;

	onMount(() => {
		live = true;
		void load();
		siblings = pds.list().then(result => result.tracks, () => []);
		return () => { live = false; };
	});

	async function load() {
		loading = true;
		problem = '';
		try {
			const result = await pds.track(rkey);
			if (current()) track = result;
			if (result) {
				const uploads = await pds.pending().catch(() => []);
				if (current()) uploadPending = uploads.some(upload => upload.uri === result.record.uri);
			}
		} catch {
			if (current()) problem = 'could not load this track.';
		} finally {
			if (current()) loading = false;
		}
	}

	async function playTrack(item: Track) {
		const tracks = await siblings ?? [];
		if (!current()) return;
		const queue = tracks.some(track => track.record.uri === item.record.uri) ? tracks : [item, ...tracks];
		player.play(item, queue);
	}

	async function remove(item: Track, check: boolean) {
		if (busy || !current()) return;
		busy = true;
		problem = '';
		try {
			const result = await (check ? pds.deletion.check(item) : pds.deletion.remove(item));
			if (!current()) return;
			if (result === 'deleted') {
				player.forgetPrivateTrack(item.record.uri);
				await goto(resolve('/(app)/portal'), { replaceState: true });
			} else {
				problem = 'this track is still in your catalog.';
				removal = 'confirm';
			}
		} catch {
			if (current()) {
				problem = 'could not confirm deletion.';
				removal = 'uncertain';
			}
		} finally {
			if (current()) busy = false;
		}
	}
</script>

{#if loading}
	<Loading label="loading track" />
{:else if track}
	{@const item = track}
	<TrackDetail track={item} {playTrack}>
		{#snippet ownerActions()}
			<div class="track-actions">
				{#if uploadPending}
					<a class="text-button" href={resolve('/upload?visibility=only-you')}>finish upload</a>
				{:else if removal}
					<p>delete “{item.metadata.title}”?</p>
					{#if !account.privateDeleting}
						<a class="text-button" href={resolve(`/login?${new URLSearchParams({ return_to: '/track/' + item.id })}`)}>sign in again to delete</a>
					{:else}
						<button class="text-button danger" type="button" disabled={busy} onclick={() => remove(item, removal === 'uncertain')}>
							{removal === 'uncertain' ? 'check whether it was deleted' : 'delete track'}
						</button>
					{/if}
					<button class="text-button" type="button" disabled={busy} onclick={() => { removal = undefined; problem = ''; }}>cancel</button>
				{:else}
					<button class="text-button" type="button" onclick={() => { removal = 'confirm'; }}>delete track</button>
				{/if}
				{#if problem}<p role="alert">{problem}</p>{/if}
				<a class="text-button" href={resolve('/(app)/portal')}>your uploads</a>
			</div>
		{/snippet}
	</TrackDetail>
{:else}
	<div class="page-content">
		{#if problem}
			<h1>track unavailable</h1>
			<p class="state" role="alert">{problem}</p>
			<button class="text-button" type="button" onclick={load}>try again</button>
		{:else}
			<h1>track not found</h1>
			<a class="text-button" href={resolve('/(app)/portal')}>your uploads</a>
		{/if}
	</div>
{/if}

<style>
	.track-actions { margin-top: 0.5rem; }
	.danger { color: var(--danger, #ad2424); }
</style>
