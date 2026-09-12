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
		const downloads = canvas.getByRole('combobox', { name: 'downloads' });
		await expect(downloads).toHaveValue('');
		await userEvent.selectOptions(downloads, 'off');
		await expect(downloads).toHaveValue('off');
		await expect(canvas.getByRole('radio', { name: /^public / })).toBeChecked();
	}}
/>
<Story
	name="Spaces available"
	args={{ visibility: 'public', showPrivate: true, privateGranted: true }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('combobox', { name: 'downloads' })).toBeVisible();
		await userEvent.click(canvas.getByRole('radio', { name: /^private / }));
		await expect(
			canvas.queryByRole('combobox', { name: 'downloads' })
		).not.toBeInTheDocument();
	}}
/>
<Story name="Unlisted downloads off" args={{ visibility: 'unlisted', downloadPolicy: 'off' }} />
<Story name="Copyright configured" args={{ visibility: 'public', restrictedToPublic: true }} />

<Story name="Artist settings" args={{ visibility: 'public' }} />
<Story name="Supporter downloads" args={{ visibility: 'public', supportUrl: 'atprotofans', downloadPolicy: 'supporters' }} />
