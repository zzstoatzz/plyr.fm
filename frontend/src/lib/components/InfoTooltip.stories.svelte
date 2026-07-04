<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InfoTooltip from './InfoTooltip.svelte';

	// InfoTooltip takes a `children` snippet for its panel content and reveals on
	// hover/focus — hover the “?” to see it.
	const { Story } = defineMeta({
		title: 'overlays/InfoTooltip',
		component: InfoTooltip,
		parameters: { layout: 'centered' }
	});
</script>

<Story name="Default">
	<InfoTooltip label="what triggers a copyright flag">
		{#snippet children()}
			every upload is scanned against a recognition database. matches are
			flagged for review — they don't remove your track.
		{/snippet}
	</InfoTooltip>
</Story>
