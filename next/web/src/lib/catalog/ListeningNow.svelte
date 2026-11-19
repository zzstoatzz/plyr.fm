<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { listeningElapsed, readListeningNow, type ListeningNow } from '@plyr/next-core/teal-status';
	import { clock } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import PlayingWave from '$lib/ui/PlayingWave.svelte';

	let { did, name }: { did: string; name: string } = $props();
	const REFRESH = 60_000;
	let status = $state.raw<ListeningNow | null>(null);
	let now = $state(Date.now());
	const elapsed = $derived(status ? listeningElapsed(status, now) : 0);
	const byline = $derived(status ? [status.artists.join(', '), status.release].filter(Boolean).join(' · ') : '');
	const href = $derived(status?.plyrTrack ? resolve('/(app)/track/[id]', { id: status.plyrTrack }) : status?.link);

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
			now = Date.now();
			const wait = next ? Math.min(REFRESH, Math.max(1000, next.endsAt - now)) : REFRESH;
			refresh = setTimeout(load, wait);
		}
		const tick = setInterval(() => {
			now = Date.now();
			if (status && now >= status.endsAt) void load();
		}, 1000);
		const visible = () => { if (document.visibilityState === 'visible') void load(); };
		document.addEventListener('visibilitychange', visible);
		void load();
		return () => {
			controller.abort();
			clearTimeout(refresh);
			clearInterval(tick);
			document.removeEventListener('visibilitychange', visible);
		};
	});
</script>

{#if status}
	<svelte:element this={href ? 'a' : 'div'} class="listening" {href}
		target={status.link && !status.plyrTrack ? '_blank' : undefined} rel={status.link && !status.plyrTrack ? 'noopener noreferrer' : undefined}
		aria-label={`${name} is listening to ${status.track}${status.artists.length ? ` by ${status.artists.join(', ')}` : ''}`}>
		<span class="eyebrow"><PlayingWave /> listening now</span>
		<span class="body">
			<span class="cover"><Artwork src={status.coverUrl} size={64} /></span>
			<span class="copy">
				<strong class="truncate">{status.track}</strong>
				{#if byline}<span class="byline truncate">{byline}</span>{/if}
				{#if status.duration}
					<span class="progress" aria-hidden="true">
						<span class="time">{clock(elapsed)}</span>
						<span class="bar"><span style:width={`${(elapsed / status.duration) * 100}%`}></span></span>
						<span class="time">{clock(status.duration)}</span>
					</span>
				{/if}
			</span>
			{#if href}<Icon name="chevron" size={16} />{/if}
		</span>
	</svelte:element>
{/if}

<style>
	.listening { display: grid; gap: 0.6rem; padding: 0.75rem 0.85rem 0.85rem; border-radius: 0.75rem; color: var(--text); text-decoration: none;
		background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--raised)), var(--raised) 70%);
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); }
	a.listening:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, var(--hover)), var(--hover) 70%); }
	.eyebrow { display: flex; align-items: center; gap: 0.45rem; color: var(--accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
	.eyebrow :global(.playing-wave) { width: 0.85rem; height: 0.85rem; }
	.body { display: flex; align-items: center; gap: 0.85rem; min-width: 0; }
	.body > :global(svg) { color: var(--faint); flex: none; }
	.cover { width: 4rem; height: 4rem; flex: none; border-radius: 0.45rem; overflow: hidden; box-shadow: 0 0.3rem 0.9rem rgb(0 0 0 / 0.22); }
	.copy { flex: 1; min-width: 0; display: grid; gap: 0.1rem; }
	.copy strong { font-weight: 700; font-size: 1.02rem; }
	.byline { color: var(--muted); font-size: 0.9rem; }
	.progress { display: flex; align-items: center; gap: 0.55rem; margin-top: 0.4rem; color: var(--faint); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
	.bar { flex: 1; height: 0.25rem; border-radius: 999px; background: color-mix(in srgb, var(--text) 14%, transparent); overflow: hidden; }
	.bar > span { display: block; height: 100%; border-radius: inherit; background: var(--text); transition: width 1s linear; }
	@media (prefers-reduced-motion: reduce) { .bar > span { transition: none; } }
</style>
