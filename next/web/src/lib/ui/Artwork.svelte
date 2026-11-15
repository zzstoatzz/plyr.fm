<script lang="ts">
	import { untrack } from 'svelte';
	import { displayUrl } from '@plyr/next-core/artwork';
	import Icon, { type IconName } from './Icon.svelte';

	let { src, fallback, size = 56, eager = false, fallbackIcon = 'music' }: { src?: string; fallback?: string; size?: number; eager?: boolean; fallbackIcon?: IconName } = $props();
	let failed = $state(0);
	const optimized = $derived(src ? displayUrl(src, size, typeof window === 'undefined' ? 1 : window.devicePixelRatio) : undefined);
	const candidates = $derived([...new Set([optimized, src,
    fallback ? displayUrl(fallback, size, typeof window === 'undefined' ? 1 : window.devicePixelRatio) : undefined,
    fallback].filter(Boolean))]);
  const image = $derived(candidates[failed]);
  $effect(() => { if (candidates.length) failed = 0; });
</script>

<span class="artwork">
	{#if image}
		<img src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onerror={() => { failed = untrack(() => failed) + 1; }} />
	{:else}
		<span class="fallback"><Icon name={fallbackIcon} size={24} /></span>
	{/if}
</span>

<style>
	.artwork { display: block; overflow: hidden; border-radius: inherit; width: 100%; aspect-ratio: 1; background: var(--raised); }
	img { width: 100%; height: 100%; object-fit: cover; }
	.fallback { display: grid; height: 100%; place-items: center; color: var(--faint); }
</style>
