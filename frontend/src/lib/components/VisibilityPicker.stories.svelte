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
	name="Public downloads"
	args={{ visibility: 'public' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const downloads = canvas.getByRole('checkbox', { name: /allow downloads/ });
		await expect(downloads).toBeChecked();
		await userEvent.click(downloads);
		await expect(downloads).not.toBeChecked();
		await expect(canvas.getByRole('radio', { name: /^public / })).toBeChecked();
	}}
/>
<Story
	name="Spaces available"
	args={{ visibility: 'public', showPrivate: true, privateGranted: true }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('checkbox', { name: /allow downloads/ })).toBeVisible();
		await userEvent.click(canvas.getByRole('radio', { name: /^private / }));
		await expect(
			canvas.queryByRole('checkbox', { name: /allow downloads/ })
		).not.toBeInTheDocument();
	}}
/>
<Story name="Unlisted downloads off" args={{ visibility: 'unlisted', allowDownloads: false }} />
<Story name="Copyright configured" args={{ visibility: 'public', restrictedToPublic: true }} />
