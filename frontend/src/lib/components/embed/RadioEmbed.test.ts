// radio embed tests: flagged artwork must always render blurred (embeds are
// unauthenticated contexts), and ?autoplay=1 tunes in once state loads.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import RadioEmbed from '$lib/components/embed/RadioEmbed.svelte';
import { moderation, type SensitiveImagesData } from '$lib/moderation.svelte';
import type { LiveBroadcast, RadioState, RadioStation } from '$lib/radio.svelte';

// hls.js needs MediaSource, which jsdom lacks
const hlsAttached = vi.hoisted(() => [] as { url: string; el: HTMLMediaElement }[]);
vi.mock('hls.js', () => ({
	default: class {
		static isSupported = () => true;
		private url = '';
		loadSource(url: string) {
			this.url = url;
		}
		attachMedia(el: HTMLMediaElement) {
			hlsAttached.push({ url: this.url, el });
		}
		destroy() {}
	}
}));

// jsdom doesn't implement media playback
const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});

const SENSITIVE_ART = 'https://images.test/images/sens123.webp';
const SAFE_ART = 'https://images.test/images/safe456.webp';

let artworkUrl = SENSITIVE_ART;
let trackNum = 1;
let serverClockOffset = 0;
let liveBroadcast: LiveBroadcast | null = null;
let withRotation = true;
const stateUrls: string[] = [];

type StationsPayload = { stations: RadioStation[] };

function jsonResponse(body: RadioState | StationsPayload | SensitiveImagesData): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function radioState(): RadioState {
	return {
		...(liveBroadcast
			? { station: 'firehose', station_slug: 'firehose' }
			: { station: 'loved', station_slug: 'loved' }),
		live: liveBroadcast,
		generated_at: new Date(Date.now() + serverClockOffset).toISOString(),
		loop_duration_seconds: 100,
		current_index: 0,
		current_started_at: null,
		current_ends_at: null,
		progress_seconds: 10,
		current: !withRotation
			? null
			: {
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
				stateUrls.push(url);
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
	serverClockOffset = 0;
	liveBroadcast = null;
	withRotation = true;
	stateUrls.length = 0;
	hlsAttached.length = 0;
	loadSpy.mockImplementation(() => {});
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
	it.each([-12, 12])('ignores a %i-hour clock difference during autoplay', async (hours) => {
		serverClockOffset = hours * 3600000;
		setEmbedUrl('?autoplay=1');
		await mountRadioEmbed();
		const audio = document.querySelector('audio')!;
		audio.dispatchEvent(new Event('loadedmetadata'));
		expect(audio.currentTime).toBeGreaterThanOrEqual(10);
		expect(audio.currentTime).toBeLessThan(11);
	});

	it('tunes in automatically with ?autoplay=1', async () => {
		artworkUrl = SAFE_ART;
		setEmbedUrl('?autoplay=1');
		await mountRadioEmbed();
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
	});

	it.each(['', '?autoplay=0'])('stays paused with %s', async (search) => {
		setEmbedUrl(search);
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

	it('preserves listening intent through the new source load pause', async () => {
		const audio = await tuneIn();
		loadSpy.mockImplementation(function (this: HTMLMediaElement) {
			this.dispatchEvent(new Event('pause'));
		});
		trackNum = 2;
		audio.dispatchEvent(new Event('ended'));
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

// shipped broken: the embed ignored `live`, so firehose either aired its
// archived rotation instead of the broadcast or read "no tracks in rotation yet"
describe('RadioEmbed live broadcast', () => {
	const BROADCAST = 'https://relay.test/live/index.m3u8';

	it('asks for the broadcast only on firehose', async () => {
		setEmbedUrl('?station=firehose');
		const component = mount(RadioEmbed, { target: document.body });
		cleanup = () => unmount(component);
		await vi.waitFor(() => expect(stateUrls.length).toBeGreaterThan(0));
		expect(new URL(stateUrls[0]).searchParams.get('catalog_only')).toBe('false');
	});

	it('keeps other stations catalog-only', async () => {
		setEmbedUrl('?station=loved');
		await mountRadioEmbed();
		expect(new URL(stateUrls[0]).searchParams.get('catalog_only')).toBe('true');
	});

	it('is on the air with an empty rotation, and tunes in to the broadcast', async () => {
		liveBroadcast = { stream_url: BROADCAST, kind: 'hls', started_at: null };
		withRotation = false;
		setEmbedUrl('?station=firehose&autoplay=1');
		const component = mount(RadioEmbed, { target: document.body });
		cleanup = () => unmount(component);
		await vi.waitFor(() => expect(hlsAttached).toHaveLength(1));
		expect(hlsAttached[0].url).toBe(BROADCAST);
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
		expect(document.querySelector('.title')?.textContent).toBe('firehose');
		expect(document.body.textContent).not.toContain('no tracks in rotation yet');
	});

	it('airs the broadcast over the rotation entry', async () => {
		liveBroadcast = { stream_url: BROADCAST, kind: 'hls', started_at: null };
		artworkUrl = SAFE_ART;
		setEmbedUrl('?station=firehose&autoplay=1');
		await mountRadioEmbed();
		await vi.waitFor(() => expect(hlsAttached).toHaveLength(1));
		expect(document.querySelector('audio')!.src).not.toBe('https://audio.test/1.mp3');
	});
});
