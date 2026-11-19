<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { readListeningNow, type ListeningNow } from '@plyr/next-core/teal-status';
	import PlayingWave from '$lib/ui/PlayingWave.svelte';

	let { did, name }: { did: string; name: string } = $props();
	const REFRESH = 60_000;
	let status = $state.raw<ListeningNow | null>(null);
	const artists = $derived(status?.artists.join(', ') ?? '');
	const href = $derived(status?.plyrTrack ? resolve('/(app)/track/[id]', { id: status.plyrTrack }) : status?.link);
	const external = $derived(!!status?.link && !status.plyrTrack);

	onMount(() => {
		const controller = new AbortController();
		let refresh: ReturnType<typeof setTimeout> | undefined;
		let loading = false;
		async function load() {
			clearTimeout(refresh);
			if (loading || document.visibilityState === 'hidden') return;
			loading = true;
			const next = await readListeningNow(did, { signal: controller.signal }).finally(() => { loading = false; });
			if (controller.signal.aborted) return;
			status = next;
			refresh = setTimeout(load, next ? Math.min(REFRESH, Math.max(1000, next.endsAt - Date.now())) : REFRESH);
		}
		const visible = () => { if (document.visibilityState === 'visible') void load(); };
		document.addEventListener('visibilitychange', visible);
		void load();
		return () => {
			controller.abort();
			clearTimeout(refresh);
			document.removeEventListener('visibilitychange', visible);
		};
	});
</script>

{#if status}
	<svelte:element this={href ? 'a' : 'span'} class="listening" {href}
		target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}
		aria-label={`${name} is listening to ${status.track}${artists ? ` by ${artists}` : ''}`}>
		<PlayingWave />
		<span class="truncate">listening to <b>{status.track}</b>{#if artists}<span class="by">&nbsp;· {artists}</span>{/if}</span>
	</svelte:element>
{/if}

<style>
	.listening { display: inline-flex; align-items: center; gap: 0.45rem; max-width: 100%; min-width: 0; color: var(--muted); font-size: 0.875rem; text-decoration: none; }
	.listening b { color: var(--text); font-weight: 600; }
	.listening :global(.playing-wave) { width: 0.8rem; height: 0.8rem; color: var(--accent); }
	a.listening:hover b { text-decoration: underline; }
	.listening :global(.playing-wave) { flex: none; }
</style>
