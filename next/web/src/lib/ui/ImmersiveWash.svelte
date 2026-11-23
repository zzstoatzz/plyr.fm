<script lang="ts">
	/** The page's art, blurred into a wash behind the whole content area: artist, album and playlist pages.
	 *  The parent is the page's article: `position: relative; isolation: isolate`, so the wash fills its padding box
	 *  on phones; on desktop it is fixed behind everything right of the sidebar and stays as the page scrolls. */
	/** photo: the artist's avatar, heavily blurred (the default); image: a cover the artist picked, softly blurred; color: a plain tint */
	let { src, mode = 'photo', color }: { src?: string; mode?: 'photo' | 'image' | 'color'; color?: string } = $props();
</script>

<div class="wash {mode}" aria-hidden="true" style:--wash-color={color}>{#if mode !== 'color' && src}<img {src} alt="" />{/if}</div>

<style>
	.wash { position: absolute; z-index: -1; top: 0; inset-inline: 0; height: min(46rem, 100dvh); overflow: hidden; pointer-events: none;
		mask-image: linear-gradient(to bottom, black, black 40%, transparent); }
	/* light mode: a white veil keeps faint text readable over a mid-tone image */
	/* a veil toward the page's own background, so the art can never end up mid-grey behind text:
	   a pale cover in dark mode or a dark one in light mode is pulled back to the theme's side */
	.wash::after { content: ''; position: absolute; inset: 0; background: light-dark(rgb(255 255 255 / 0.55), rgb(10 10 10 / 0.5)); }
	img { width: 100%; height: 100%; object-fit: cover; filter: blur(72px) saturate(1.3); transform: scale(1.4); opacity: 0.6; }
	.image img { filter: blur(18px) saturate(1.1); transform: scale(1.1); opacity: 0.8; }
	.image::after { background: light-dark(rgb(255 255 255 / 0.6), rgb(10 10 10 / 0.55)); }
	.color { background: radial-gradient(120% 80% at 30% 0%, color-mix(in srgb, var(--wash-color) 70%, transparent), transparent 75%); }
	.color::after { background: light-dark(rgb(255 255 255 / 0.35), transparent); }
	@media (min-width: 1100px) {
		.wash { position: fixed; top: 0; left: var(--sidebar); right: 0; height: 100dvh; mask-image: linear-gradient(to bottom, black, black 30%, rgb(0 0 0 / 0.45)); }
	}
	@media (max-width: 720px) {
		.wash { height: 30rem; }
	}
</style>
