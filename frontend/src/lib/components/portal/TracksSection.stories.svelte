<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn, userEvent } from 'storybook/test';
	import TracksSection from './TracksSection.svelte';
	import type { Track } from '$lib/types';

	const track: Track = {
		id: 1177,
		title: 'Midnight transmission',
		artist: 'Demo artist',
		artist_handle: 'demo.plyr.fm',
		artist_did: 'did:plc:demoartist',
		file_id: 'midnight-transmission',
		file_type: 'wav',
		play_count: 42,
		created_at: '2026-07-17T00:00:00Z',
		description: 'A long-form late-night broadcast.',
		tags: ['spoken-word'],
		features: [],
		audio_storage: 'pds',
		self_labels: ['sexual'],
		operator_labels: ['sexual'],
		labels: ['sexual']
	};

	const { Story } = defineMeta({
		title: 'portal/TracksSection',
		component: TracksSection,
		parameters: { layout: 'padded' },
		play: async ({ canvas }) => {
			await userEvent.click(canvas.getByRole('button', { name: 'edit' }));
		},
		args: {
			tracks: [track],
			tracksTotal: 1,
			tracksHasMore: false,
			loadingTracks: false,
			loadingMoreTracks: false,
			albums: [],
			atprotofansEligible: true,
			onLoadMore: fn(),
			onTracksChanged: fn(async () => undefined)
		}
	});
</script>

<!-- Open the editor with the edit button; this fixture includes both creator
     and operator adult labels so the provenance state stays reproducible. -->
<Story name="Creator track" />
