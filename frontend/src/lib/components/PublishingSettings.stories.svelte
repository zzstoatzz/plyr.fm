<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, within } from 'storybook/test';
	import PublishingSettings from './PublishingSettings.svelte';
	import { defaultPublishing } from '$lib/publishing';

	const { Story } = defineMeta({
		title: 'upload/PublishingSettings',
		component: PublishingSettings,
		parameters: { layout: 'padded' }
	});
</script>

<Story
	name="Portal defaults"
	args={{ value: null, defaults: defaultPublishing(), showRights: true }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('anyone can listen · downloads allowed')).toBeVisible();
		await expect(canvas.getByRole('checkbox', { name: 'anyone can listen' })).not.toBeVisible();
		await userEvent.click(canvas.getByText('change for this track'));
		await userEvent.click(canvas.getByRole('checkbox', { name: 'anyone can download' }));
		await expect(canvas.getByText('anyone can listen · downloads off')).toBeVisible();
		await expect(canvas.getByRole('checkbox', { name: 'anyone can listen' })).toBeChecked();
		await userEvent.click(canvas.getByRole('button', { name: 'use Portal defaults' }));
		await expect(canvas.getByText('anyone can listen · downloads allowed')).toBeVisible();
	}}
/>
<Story
	name="Public listening with files protected"
	args={{
		value: null,
		defaults: {
			access: { listening: 'public', downloads: 'off', visibility: 'public' },
			attach_rights: false
		}
	}}
/>
<Story
	name="Album defaults"
	args={{
		value: null,
		source: 'album',
		defaults: {
			access: { listening: 'supporters', downloads: 'off', visibility: 'public' },
			attach_rights: false
		}
	}}
/>
<Story
	name="Space audience"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByText('change for this track'));
		await expect(canvas.getByRole('checkbox', { name: 'anyone can download' })).toBeDisabled();
		await expect(canvas.queryByLabelText('who can download?')).not.toBeInTheDocument();
		await expect(canvas.queryByText('more options')).not.toBeInTheDocument();
	}}
	args={{
		value: {
			access: { listening: 'space', downloads: 'off', visibility: 'private' },
			attach_rights: false
		},
		defaults: defaultPublishing(),
		showSpace: true
	}}
/>
