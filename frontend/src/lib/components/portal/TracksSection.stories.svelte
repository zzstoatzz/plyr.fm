<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent } from 'storybook/test';
	import TracksSection from './TracksSection.svelte';
	import type { Track } from '$lib/types';
	import { defaultPublishing } from '$lib/publishing';

	const track: Track = {
		id: 1177,
		title: 'Midnight transmission',
		artist: 'Demo artist',
		artist_handle: 'demo.plyr.fm',
		artist_did: 'did:plc:demoartist',
		file_id: 'midnight-transmission',
		file_type: 'wav',
		publishing: defaultPublishing(),
		policy_origin: 'portal',
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
			const search = canvas.getByRole('searchbox', { name: 'filter your tracks' });
			await userEvent.type(search, 'midnight');
			const mobile = window.matchMedia('(max-width: 768px), (any-pointer: coarse)').matches;
			if (mobile) {
				expect(Number.parseFloat(window.getComputedStyle(search).fontSize)).toBeGreaterThanOrEqual(
					16
				);
				expect(
					Number.parseFloat(
						window.getComputedStyle(canvas.getByRole('combobox', { name: 'sort tracks' })).fontSize
					)
				).toBeGreaterThanOrEqual(16);
			} else {
				expect(window.getComputedStyle(search).fontSize).toBe('14.4px');
			}
			await userEvent.click(canvas.getByRole('button', { name: 'edit track' }));
			const editor = document.querySelector('dialog');
			if (!editor) throw new Error('track editor did not open');
			if (mobile) {
				for (const field of editor.querySelectorAll(
					'input:not([type="checkbox"]):not([type="file"]), textarea, select'
				)) {
					expect(Number.parseFloat(window.getComputedStyle(field).fontSize)).toBeGreaterThanOrEqual(
						16
					);
				}
			}
			expect(window.getComputedStyle(document.body).touchAction).toBe('manipulation');
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

<Story
	name="Phone input sizing"
	parameters={{
		viewport: {
			defaultViewport: 'phone',
			options: { phone: { name: 'phone', styles: { width: '390px', height: '844px' } } }
		}
	}}
/>
