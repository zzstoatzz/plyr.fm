<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth';
	import OwnerTrack from '$lib/catalog/OwnerTrack.svelte';
	import TrackDetail from '$lib/catalog/TrackDetail.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

{#if data.track}
	<TrackDetail track={data.track} />
{:else if !account.ready}
	<Loading label="loading track" />
{:else if account.did && account.rpc}
	{#key account.rpc}
		{#key data.ownerKey}<OwnerTrack {account} rkey={data.ownerKey} />{/key}
	{/key}
{:else}
	<div class="page-content"><h1>track not found</h1><a href="/">browse tracks</a></div>
{/if}
