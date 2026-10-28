<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PdsSaveControl from './PdsSaveControl.svelte';
	import type { Track } from '$lib/types';

	const protectedSpace: Track = {
		id: 1,
		title: 'Space audio',
		artist: 'artist',
		artist_handle: 'artist.test',
		file_id: 'protected',
		file_type: 'mp3',
		play_count: 0,
		audio_storage: 'r2_private',
		audio_space:
			'at://did:plc:artist/space/fm.plyr.stg.privateMedia/playback/did:plc:artist/fm.plyr.stg.track/audio'
	};
	const { Story } = defineMeta({
		title: 'portal/PdsSaveControl',
		component: PdsSaveControl,
		parameters: {
			layout: 'padded',
			sveltekit_experimental: {
				stores: {
					page: { url: new URL('http://localhost/portal/manage') },
					navigating: {},
					updated: false
				}
			}
		}
	});
</script>

<Story name="Protected audio on PDS" args={{ tracks: [protectedSpace] }} />
<Story
	name="Some protected audio only on plyr"
	args={{ tracks: [protectedSpace, { ...protectedSpace, id: 2, audio_space: null }] }}
/>
