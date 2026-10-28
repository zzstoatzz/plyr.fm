<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, userEvent, waitFor, within } from 'storybook/test';
	import UploadStorageNotice from './UploadStorageNotice.svelte';
	import { stashAlbumUpload, takeAlbumUpload } from '$lib/record-stash';
	import RecordingDraftProbe from '../../tests/fixtures/RecordingDraftProbe.svelte';
	import { defaultPublishing } from '$lib/publishing';

	const { Story } = defineMeta({
		title: 'upload/UploadStorageNotice',
		component: UploadStorageNotice,
		parameters: { layout: 'padded' }
	});
</script>

<Story
	name="Artist-owned Space"
	args={{ protectedAudio: true, spacesSupported: true, accepted: false }}
/>
<Story
	name="Accept plyr-only storage"
	args={{ protectedAudio: true, spacesSupported: false, accepted: false }}
	play={async ({ canvasElement }) => {
		const checkbox = within(canvasElement).getByRole('checkbox');
		await expect(checkbox).not.toBeChecked();
		await userEvent.click(checkbox);
		await expect(checkbox).toBeChecked();
	}}
/>
<Story
	name="Uploading"
	args={{ protectedAudio: true, spacesSupported: false, accepted: true, disabled: true }}
/>

<Story
	name="Album draft survives approval"
	args={{ protectedAudio: true, spacesSupported: true, accepted: false }}
	play={async () => {
		const publishing = defaultPublishing();
		publishing.access.downloads = 'off';
		const saved = await stashAlbumUpload({
			albumTitle: 'saved album',
			publishing,
			coverArtFile: new File(['cover'], 'cover.png', { type: 'image/png' }),
			attestedRights: true,
			tracks: [
				{
					id: 'draft',
					file: new File(['audio'], 'track.mp3', { type: 'audio/mpeg' }),
					title: 'saved track',
					description: 'saved description',
					tags: ['demo'],
					featuredArtists: [],
					hasUnresolvedFeaturesInput: false,
					autoTag: false,
					sensitiveAudio: false,
					publishing: null,
					status: 'pending',
					error: null
				}
			]
		});
		await expect(saved).toBe(true);
		const restored = await takeAlbumUpload();
		await expect(restored?.albumTitle).toBe('saved album');
		await expect(restored?.publishing.access.downloads).toBe('off');
		await expect(await restored?.tracks[0].file?.text()).toBe('audio');
		await expect(await restored?.coverArtFile?.text()).toBe('cover');
		await expect(restored?.tracks[0].description).toBe('saved description');
		await expect(await takeAlbumUpload()).toBeNull();
	}}
/>

<Story
	name="Recording proxy survives approval"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'save recording draft' }));
		await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('draft restored'));
	}}
>
	{#snippet template()}
		<RecordingDraftProbe />
	{/snippet}
</Story>
