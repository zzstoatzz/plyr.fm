<script lang="ts">
	import { onMount } from 'svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import type { FeaturedArtist } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';

	let members = $state<FeaturedArtist[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	const supported = $derived(auth.user?.permissioned_spaces?.supported ?? false);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`${API_URL}/artists/me/private-media/members`, {
				credentials: 'include'
			});
			if (res.ok) members = await res.json();
		} catch (_e) {
			console.error('failed to load private media members:', _e);
		} finally {
			loading = false;
		}
	}

	async function add(artist: FeaturedArtist) {
		busy = true;
		try {
			const res = await fetch(`${API_URL}/artists/me/private-media/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ actor: artist.did })
			});
			if (!res.ok) {
				const detail = await res.json().catch(() => null);
				toast.error(detail?.detail ?? "couldn't add them");
				return;
			}
			members = [...members, await res.json()];
			toast.success(`@${artist.handle} can hear your private tracks`);
		} catch (_e) {
			console.error('failed to add private media member:', _e);
			toast.error("couldn't add them");
		} finally {
			busy = false;
		}
	}

	async function remove(did: string) {
		const who = members.find((m) => m.did === did);
		busy = true;
		try {
			const res = await fetch(
				`${API_URL}/artists/me/private-media/members/${encodeURIComponent(did)}`,
				{ method: 'DELETE', credentials: 'include' }
			);
			if (!res.ok) {
				toast.error("couldn't remove them");
				return;
			}
			members = members.filter((m) => m.did !== did);
			if (who) toast.info(`removed @${who.handle} — they can't play your private tracks anymore`);
		} catch (_e) {
			console.error('failed to remove private media member:', _e);
			toast.error("couldn't remove them");
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		if (supported) void load();
		else loading = false;
	});
</script>

{#if supported}
	<section class="private-media-section">
		<div class="section-header">
			<h2>private tracks</h2>
			{#if members.length > 0}
				<span class="count">{members.length} {members.length === 1 ? 'listener' : 'listeners'}</span>
			{/if}
		</div>
		<p class="lede">
			only you can play your private tracks. add people here and they can too. they need an
			account on a PDS that supports private media and to have signed in to plyr.fm, and the
			list is kept on your PDS.
		</p>

		{#if loading}
			<div class="loading-container">
				<WaveLoading size="lg" message="loading..." />
			</div>
		{:else}
			<HandleSearch
				selected={members}
				onAdd={add}
				onRemove={remove}
				maxFeatures={100}
				disabled={busy}
			/>
			{#if members.length === 0}
				<p class="empty">nobody yet — your private tracks are yours alone.</p>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.private-media-section {
		margin-bottom: 2.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.count {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.lede {
		margin: 0 0 1rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.empty {
		margin: 0.75rem 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.loading-container {
		display: flex;
		justify-content: center;
		padding: 2rem 1rem;
	}
</style>
