<script lang="ts">
	import { untrack } from 'svelte';
	import { displayUrl } from '$core/artwork';
	import Icon from './Icon.svelte';

	let { src, size = 56, eager = false }: { src?: string; size?: number; eager?: boolean } = $props();
	let failed = $state(0);
	$effect(() => { if (src) failed = 0; });
	const optimized = $derived(src ? displayUrl(src, size, typeof window === 'undefined' ? 1 : window.devicePixelRatio) : undefined);
	const image = $derived(failed === 0 ? optimized : failed === 1 && src !== optimized ? src : undefined);
</script>

<span class="artwork">
	{#if image}
		<img src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onerror={() => { failed = untrack(() => failed) + 1; }} />
	{:else}
		<span class="fallback"><Icon name="music" size={24} /></span>
	{/if}
</span>

<style>
	.artwork { display: block; overflow: hidden; border-radius: inherit; width: 100%; aspect-ratio: 1; background: var(--raised); }
	img { width: 100%; height: 100%; object-fit: cover; }
	.fallback { display: grid; height: 100%; place-items: center; color: var(--faint); }
</style>
