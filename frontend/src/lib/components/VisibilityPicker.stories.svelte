<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, within } from 'storybook/test';
	import VisibilityPicker from './VisibilityPicker.svelte';

	const { Story } = defineMeta({
		title: 'upload/VisibilityPicker',
		component: VisibilityPicker,
		parameters: { layout: 'padded' }
	});
</script>

<Story
	name="Private files"
	args={{ visibility: 'public' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const option = canvas.getByRole('radio', { name: /public listening, private files/ });
		await userEvent.click(option);
		await expect(option).toBeChecked();
	}}
/>
<Story
	name="Spaces available"
	args={{ visibility: 'private', showPrivate: true, privateGranted: true }}
/>
<Story name="Copyright configured" args={{ visibility: 'public', restrictedToPublic: true }} />
