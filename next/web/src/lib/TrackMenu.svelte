<script lang="ts">
	// the "…" sheet for a track (social-app's post overflow menu).
	import { goto } from '$app/navigation';
	import { auth } from './auth.svelte';
	import { menus, share } from './menus.svelte';
	import { artistName, player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon, { type IconName } from './ui/Icon.svelte';
	import Sheet from './ui/Sheet.svelte';
	import { toast } from './ui/toast.svelte';


	function act(fn: () => unknown) {
		return () => {
			menus.track = null;
			fn();
		};
	}

	const items = $derived.by(() => {
		const t = menus.track;
		if (!t) return [];
		const list: { icon: IconName; label: string; run: () => unknown }[] = [
			{ icon: 'play_circle', label: 'play next', run: () => (player.playNext(t), toast.show('playing next')) },
			{ icon: 'queue', label: 'add to queue', run: () => (player.addToQueue(t), toast.show('added to queue')) },
			{
				icon: 'plus',
				label: 'add to playlist',
				run: () => {
					if (!auth.did) return goto('/login');
					// let this sheet close before the next one opens
					setTimeout(() => (menus.addTo = t), 200);
				}
			},
			{ icon: 'user', label: `go to ${artistName(t)}`, run: () => goto(`/u/${t.artist.profile.handle}`) },
			{
				icon: 'share',
				label: 'share',
				run: async () => {
					const r = await share(`/track/${t.id}`, t.metadata.title);
					if (r === 'copied') toast.show('link copied');
				}
			}
		];
		return list;
	});
</script>

<Sheet open={!!menus.track} onclose={() => (menus.track = null)}>
	{#if menus.track}
		{@const t = menus.track}
		<div class="head">
			<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size={44} />
			<div class="meta">
				<strong class="ellipsis">{t.metadata.title}</strong>
				<span class="muted small ellipsis">{artistName(t)}</span>
			</div>
		</div>
		<div class="list">
			{#each items as item (item.label)}
				<button class="row-item" onclick={act(item.run)}>
					<Icon name={item.icon} />
					<span class="grow">{item.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: var(--s-md);
		padding: 0 0 var(--s-md);
		border-bottom: 1px solid var(--c-50);
		margin-bottom: var(--s-xs);
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.row-item {
		padding-left: var(--s-xs);
		padding-right: var(--s-xs);
		border-radius: var(--r-sm);
	}
</style>
