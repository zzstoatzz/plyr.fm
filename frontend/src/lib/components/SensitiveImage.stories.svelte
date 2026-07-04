<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SensitiveImage from './SensitiveImage.svelte';

	// inline SVG artwork so the story pulls no network image.
	const ART =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%236a9fff'/%3E%3Cstop offset='1' stop-color='%23c04bff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='240' height='240' fill='url(%23g)'/%3E%3C/svg%3E";

	const { Story } = defineMeta({
		title: 'media/SensitiveImage',
		component: SensitiveImage,
		parameters: { layout: 'centered' }
	});
</script>

<!-- default: nothing marks this image sensitive, so it shows through -->
<Story name="Revealed">
	<SensitiveImage src={ART}>
		{#snippet children()}
			<img src={ART} alt="cover" style="width:200px;height:200px;border-radius:8px;display:block" />
		{/snippet}
	</SensitiveImage>
</Story>

<!-- unauthenticated contexts (e.g. embeds) pass respectPreference={false}, which
     always blurs regardless of the viewer's preference -->
<Story name="Blurred (embed context)">
	<SensitiveImage src={ART} respectPreference={false}>
		{#snippet children()}
			<img src={ART} alt="cover" style="width:200px;height:200px;border-radius:8px;display:block" />
		{/snippet}
	</SensitiveImage>
</Story>
