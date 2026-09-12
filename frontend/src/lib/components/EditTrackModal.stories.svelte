<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import EditTrackModal from './EditTrackModal.svelte';
	import type { Track } from '$lib/types';
	import { defaultPublishing } from '$lib/publishing';

	const track = {
		id: 0,
		title: 'a track with a long editing form',
		artist: 'artist',
		artist_handle: 'artist.test',
		artist_did: 'did:plc:artist',
		file_id: 'test',
		file_type: 'mp3',
		publishing: defaultPublishing(),
		policy_origin: 'portal',
		play_count: 0,
		atproto_record_uri: 'at://did:plc:artist/fm.plyr.track/test'
	} satisfies Track;
	const { Story } = defineMeta({
		title: 'editing/EditTrackModal',
		component: EditTrackModal,
		args: { track, albums: [], atprotofansEligible: false, onClose: fn(), onSaved: fn() }
	});
</script>

<Story
	name="Scrollable form"
	play={async () => {
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
		const editor = document.querySelector<HTMLElement>('.editor');
		const form = document.querySelector<HTMLFormElement>('.edit-container');
		const actions = document.querySelector<HTMLElement>('.edit-actions');
		if (!editor || !form || !actions) throw new Error('editor did not render');
		editor.style.maxHeight = '400px';
		form.scrollTop = form.scrollHeight;
		await waitFor(() => expect(form.scrollTop).toBeGreaterThan(0));
		expect(form.clientHeight).toBeLessThan(form.scrollHeight);
		expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			editor.getBoundingClientRect().bottom + 1
		);
		const record = editor.querySelector<HTMLAnchorElement>('.record-link');
		expect(record?.href).toBe('https://pds.ls/at/did:plc:artist/fm.plyr.track/test');
	}}
/>
