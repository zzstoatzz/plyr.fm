<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PlaylistCover from './PlaylistCover.svelte';

	// inline SVG artwork so the stories pull no network images
	function art(a: string, b: string): string {
		return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23${a}'/%3E%3Cstop offset='1' stop-color='%23${b}'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='240' height='240' fill='url(%23g)'/%3E%3C/svg%3E`;
	}

	const ARTS = [
		art('6a9fff', 'c04bff'),
		art('ff9f6a', 'ff4b6e'),
		art('6affc4', '4b8bff'),
		art('ffe86a', 'ff8b4b')
	];

	const { Story } = defineMeta({
		title: 'media/PlaylistCover',
		component: PlaylistCover,
		parameters: { layout: 'centered' }
	});
</script>

<!-- an explicit playlist image always wins, even with member artwork present -->
<Story name="Explicit image">
	<div style="width:200px;height:200px;border-radius:8px;overflow:hidden">
		<PlaylistCover imageUrl={ARTS[0]} previews={ARTS} alt="playlist cover" />
	</div>
</Story>

<!-- fewer than 4 distinct member artworks: the first stands in for the cover
     (spotify's rule — no 2- or 3-pane splits) -->
<Story name="Fallback to first artwork">
	<div style="width:200px;height:200px;border-radius:8px;overflow:hidden">
		<PlaylistCover previews={ARTS.slice(0, 2)} alt="playlist cover" />
	</div>
</Story>

<!-- 4+ distinct member artworks: 2x2 mosaic in playlist order -->
<Story name="Mosaic">
	<div style="width:200px;height:200px;border-radius:8px;overflow:hidden">
		<PlaylistCover previews={ARTS} alt="playlist cover" />
	</div>
</Story>
