import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import CollectionEmbed from './CollectionEmbed.svelte';
import type { CollectionData } from '$lib/types';

const collection = {
	title: 'a collection',
	subtitle: 'artist',
	subtitleUrl: 'https://plyr.fm/u/artist.test',
	collectionUrl: 'https://plyr.fm/playlist/1',
	imageUrl: null,
	tracks: [
		{
			id: 1,
			title: 'a track',
			artist: 'artist',
			artist_handle: 'artist.test',
			artist_did: 'did:plc:artist',
			file_id: 'audio',
			file_type: 'mp3',
			play_count: 0,
			r2_url: 'https://audio.test/track.mp3'
		}
	]
} satisfies CollectionData;
let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

async function renderEmbed(value: CollectionData = collection): Promise<HTMLInputElement> {
	const component = mount(CollectionEmbed, { target: document.body, props: { collection: value } });
	cleanup = () => {
		void unmount(component);
	};
	await tick();
	const seek = document.querySelector<HTMLInputElement>('input[aria-label="Seek"]');
	if (!seek) throw new Error('seek control missing');
	return seek;
}

describe('collection embed transport', () => {
	it('keeps seeking disabled until a finite duration is available, then seeks in seconds', async () => {
		const seek = await renderEmbed();
		expect(seek.disabled).toBe(true);
		const audio = document.querySelector('audio');
		if (!audio) throw new Error('audio missing');
		vi.spyOn(audio, 'duration', 'get').mockReturnValue(120);
		audio.dispatchEvent(new Event('durationchange'));
		await tick();
		expect(seek.disabled).toBe(false);
		expect(seek.max).toBe('120');
		seek.value = '37.5';
		seek.dispatchEvent(new Event('input', { bubbles: true }));
		expect(audio.currentTime).toBe(37.5);
	});
	it('disables playback and seeking for an empty collection', async () => {
		const seek = await renderEmbed({ ...collection, tracks: [] });
		expect(seek.disabled).toBe(true);
		expect(document.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.disabled).toBe(
			true
		);
		expect(document.querySelector('audio')).toBeNull();
	});
	it('does not mount audio for adult-labeled content', async () => {
		await renderEmbed({ ...collection, tracks: [{ ...collection.tracks[0], labels: ['porn'] }] });
		expect(document.querySelector('audio')).toBeNull();
		expect(document.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.disabled).toBe(
			true
		);
	});
});
