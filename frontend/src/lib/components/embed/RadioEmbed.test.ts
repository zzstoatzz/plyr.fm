// radio embed tests: flagged artwork must always render blurred (embeds are
// unauthenticated contexts), and ?autoplay=1 tunes in once state loads.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import RadioEmbed from '$lib/components/embed/RadioEmbed.svelte';
import { moderation, type SensitiveImagesData } from '$lib/moderation.svelte';
import type { RadioState, RadioStation } from '$lib/radio.svelte';

// jsdom doesn't implement media playback
const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});

const SENSITIVE_ART = 'https://images.test/images/sens123.webp';
const SAFE_ART = 'https://images.test/images/safe456.webp';

let artworkUrl = SENSITIVE_ART;
let trackNum = 1;

type StationsPayload = { stations: RadioStation[] };

function jsonResponse(body: RadioState | StationsPayload | SensitiveImagesData): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function radioState(): RadioState {
	return {
		station: 'loved',
		station_slug: 'loved',
		generated_at: new Date().toISOString(),
		loop_duration_seconds: 100,
		current_index: 0,
		current_started_at: null,
		current_ends_at: null,
		progress_seconds: 10,
		current: {
			id: trackNum,
			title: `track ${trackNum}`,
			artist: 'artist',
			artist_handle: 'artist.test',
			artist_did: 'did:plc:artist',
			stream_url: `https://audio.test/${trackNum}.mp3`,
			file_type: 'mp3',
			duration: 100,
			artwork_url: artworkUrl,
			thumbnail_url: null,
			atproto_record_uri: null,
			atproto_record_cid: null,
			created_at: '2026-01-01T00:00:00Z',
			tags: [],
			like_count: 0,
			play_count: 0,
			liked: false
		},
		up_next: [],
		rotation: []
	};
}

let cleanup: (() => void) | null = null;

// the embed reads ?station= and ?autoplay= from its own location
function setEmbedUrl(search: string): void {
	window.history.replaceState(null, '', `/${search}`);
}

async function mountRadioEmbed(): Promise<HTMLImageElement> {
	const component = mount(RadioEmbed, { target: document.body });
	cleanup = () => unmount(component);
	let img: HTMLImageElement | null = null;
	await vi.waitFor(() => {
		img = document.querySelector<HTMLImageElement>('img.art');
		expect(img).toBeTruthy();
	});
	if (!img) throw new Error('now-playing artwork did not render');
	return img;
}

beforeAll(async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url.includes('/moderation/sensitive-images')) {
				return jsonResponse({ image_ids: ['sens123'], urls: [] });
			}
			if (url.includes('/radio/stations')) {
				return jsonResponse({
					stations: [{ slug: 'loved', name: 'loved', description: '', is_default: true }]
				});
			}
			if (url.includes('/radio/state')) {
				return jsonResponse(radioState());
			}
			return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
		})
	);
	// seed the registry the same way the root layout does (moderation.initialize → fetch)
	await moderation.fetch();
});

afterEach(() => {
	cleanup?.();
	cleanup = null;
	document.body.innerHTML = '';
	setEmbedUrl('');
	trackNum = 1;
	playSpy.mockClear();
});

describe('RadioEmbed sensitive artwork', () => {
	it('blurs flagged now-playing artwork', async () => {
		artworkUrl = SENSITIVE_ART;
		const img = await mountRadioEmbed();
		expect(img.closest('.sensitive-wrapper.blur')).toBeTruthy();
	});

	it('does not blur unflagged artwork', async () => {
		artworkUrl = SAFE_ART;
		const img = await mountRadioEmbed();
		expect(img.closest('.sensitive-wrapper.blur')).toBeNull();
	});
});

describe('RadioEmbed autoplay', () => {
	it('tunes in automatically with ?autoplay=1', async () => {
		artworkUrl = SAFE_ART;
		setEmbedUrl('?autoplay=1');
		await mountRadioEmbed();
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
	});

	it('stays paused without the param', async () => {
		artworkUrl = SAFE_ART;
		await mountRadioEmbed();
		expect(playSpy).not.toHaveBeenCalled();
	});
});

// regression for the boundary bug: the browser fires pause before ended, which
// used to clear the playing flag and leave the next track loaded but silent
describe('RadioEmbed auto-advance', () => {
	async function tuneIn(): Promise<HTMLAudioElement> {
		artworkUrl = SAFE_ART;
		setEmbedUrl('?autoplay=1');
		await mountRadioEmbed();
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
		playSpy.mockClear();
		const audio = document.querySelector('audio');
		if (!audio) throw new Error('embed audio element did not render');
		return audio;
	}

	it('keeps playing the next track when the current one ends', async () => {
		const audio = await tuneIn();
		trackNum = 2;
		// jsdom pins .ended to false; a real end-of-track pause sees ended=true
		const endedSpy = vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockReturnValue(true);
		audio.dispatchEvent(new Event('pause')); // browsers fire pause first…
		audio.dispatchEvent(new Event('ended')); // …then ended
		endedSpy.mockRestore();
		await vi.waitFor(() => expect(audio.src).toBe('https://audio.test/2.mp3'));
		audio.dispatchEvent(new Event('loadedmetadata'));
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
	});

	it('does not resume after an explicit pause', async () => {
		const audio = await tuneIn();
		audio.dispatchEvent(new Event('pause')); // user pause: element not ended
		trackNum = 2;
		audio.dispatchEvent(new Event('ended'));
		await vi.waitFor(() => expect(audio.src).toBe('https://audio.test/2.mp3'));
		audio.dispatchEvent(new Event('loadedmetadata'));
		expect(playSpy).not.toHaveBeenCalled();
	});
});
