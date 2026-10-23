<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import HideTagSheet from './HideTagSheet.svelte';

	const { Story } = defineMeta({
		title: 'overlays/HideTagSheet',
		component: HideTagSheet,
		parameters: { layout: 'fullscreen' },
		args: { hiddenTags: ['ai', 'self-hosted'], onHide: fn(), onUnhide: fn() }
	});

	let sheet: ReturnType<typeof HideTagSheet> | undefined;
	const openOnMount = () => {
		setTimeout(() => sheet?.open());
	};
</script>

<Story name="Open">
	{#snippet template(args)}
		<div {@attach openOnMount}></div>
		<button type="button" style="margin: 2rem;" onclick={() => sheet?.open()}>hide a tag</button>
		<HideTagSheet {...args} bind:this={sheet} />
	{/snippet}
</Story>
