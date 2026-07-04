<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import TrackItem from './TrackItem.svelte';
	import type { Track } from '$lib/types';

	const ART =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%236a9fff'/%3E%3Cstop offset='1' stop-color='%23c04bff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='240' height='240' fill='url(%23g)'/%3E%3C/svg%3E";

	const track: Track = {
		id: 1,
		title: 'Escape Mix',
		artist: 'woody',
		artist_handle: 'woody.fm',
		file_id: 'demo-file-id',
		file_type: 'mp3',
		image_url: ART,
		play_count: 1284,
		like_count: 42,
		comment_count: 7,
		tags: ['house', 'disco']
	};

	const { Story } = defineMeta({
		title: 'track/TrackItem',
		component: TrackItem,
		parameters: { layout: 'padded' },
		args: { track, onPlay: fn(), isAuthenticated: true }
	});
</script>

<Story name="Default" />

<Story name="Playing" args={{ isPlaying: true }} />

<Story name="Copyright flagged" args={{ track: { ...track, copyright_flagged: true, copyright_match: 'Matryoshka by Gui Boratto' } }} />

<Story name="Logged out" args={{ isAuthenticated: false }} />
