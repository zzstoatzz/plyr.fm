<script lang="ts">
	// cover art, or a quiet gradient seeded from the title so rows stay scannable.
	let {
		src,
		seed = '',
		size = 44,
		radius = 'var(--r-sm)',
		round = false
	}: { src?: string | null; seed?: string; size?: number | string; radius?: string; round?: boolean } = $props();
	let failed = $state(false);
	$effect(() => {
		src;
		failed = false;
	});
	const hue = $derived([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);
	const dim = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<span class="art" style:width={dim} style:height={dim} style:border-radius={round ? '50%' : radius}>
	{#if src && !failed}
		<img {src} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
	{:else}
		<span class="fallback" style:--h={hue} aria-hidden="true"></span>
	{/if}
</span>

<style>
	.art {
		position: relative;
		display: block;
		flex-shrink: 0;
		overflow: hidden;
		background: var(--c-50);
	}
	.art::after {
		/* hairline so light art doesn't bleed into the page (social-app MediaInsetBorder) */
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-1000) 8%, transparent);
		pointer-events: none;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.fallback {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			135deg,
			hsl(var(--h) 45% 62%),
			hsl(calc(var(--h) + 40) 50% 42%)
		);
	}
</style>
