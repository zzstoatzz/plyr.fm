import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TrackItem from '$lib/components/TrackItem.svelte';
import TrackCard from '$lib/components/TrackCard.svelte';
import type { Track } from '$lib/types';

// jsdom's <audio> answers '' to every canPlayType, so an aiff interim rendition
// is "awaiting playable" here — same as Chrome/Firefox in real life.
function track(overrides: Partial<Track> = {}): Track {
	return {
		id: 1,
		title: 'food chain',
		artist: 'woody',
		artist_did: 'did:plc:a',
		artist_handle: 'woody.test',
		file_id: 'f1',
		file_type: 'mp3',
		play_count: 0,
		like_count: 0,
		created_at: '2026-01-01T00:00:00Z',
		...overrides
	};
}

const PROCESSING = track({
	file_type: 'aiff',
	original_file_id: 'o1',
	original_file_type: 'aiff',
	is_optimizing: true
});

vi.stubGlobal('matchMedia', (query: string) => ({
	matches: false,
	media: query,
	addEventListener: () => {},
	removeEventListener: () => {}
}));

let component: object | null = null;

afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

describe('TrackItem processing state', () => {
	it('disables play and shows the processing badge while the rendition is undecodable', () => {
		const onPlay = vi.fn();
		component = mount(TrackItem, { target: document.body, props: { track: PROCESSING, onPlay } });
		flushSync();

		const play = document.querySelector('button.track-play');
		if (!(play instanceof HTMLButtonElement)) throw new Error('play button not rendered');
		expect(play.disabled).toBe(true);
		expect(document.querySelector('.processing-badge')).not.toBeNull();
		play.click();
		expect(onPlay).not.toHaveBeenCalled();
	});

	it('plays normally once the mp3 rendition has landed', () => {
		const onPlay = vi.fn();
		const ready = track({ original_file_id: 'o1', original_file_type: 'aiff', is_optimizing: false });
		component = mount(TrackItem, { target: document.body, props: { track: ready, onPlay } });
		flushSync();

		const play = document.querySelector('button.track-play');
		if (!(play instanceof HTMLButtonElement)) throw new Error('play button not rendered');
		expect(play.disabled).toBe(false);
		expect(document.querySelector('.processing-badge')).toBeNull();
		play.click();
		expect(onPlay).toHaveBeenCalledWith(ready);
	});
});

describe('TrackCard processing state', () => {
	it('ignores clicks and shows the processing badge while the rendition is undecodable', () => {
		const onPlay = vi.fn();
		component = mount(TrackCard, { target: document.body, props: { track: PROCESSING, onPlay } });
		flushSync();

		const card = document.querySelector('button.track-card');
		if (!(card instanceof HTMLButtonElement)) throw new Error('card not rendered');
		expect(card.getAttribute('aria-disabled')).toBe('true');
		expect(document.querySelector('.processing-badge')).not.toBeNull();
		card.click();
		expect(onPlay).not.toHaveBeenCalled();
	});
});
