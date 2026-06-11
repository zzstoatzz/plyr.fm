// radio embed tests: flagged artwork must always render blurred (embeds are
// unauthenticated contexts), and ?autoplay=1 tunes in once state loads.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';

const prefs = vi.hoisted(() => ({ showSensitiveArtwork: false }));
vi.mock('$lib/preferences.svelte', () => ({ preferences: prefs }));

// the shared $app/stores stub pins the url to http://localhost/ — the embed
// reads ?station= and ?autoplay= from it, so tests need a controllable url
const pageUrl = vi.hoisted(() => ({ value: 'http://localhost/' }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: { url: URL }) => void) {
			run({ url: new URL(pageUrl.value) });
			return () => {};
		}
	}
}));

// jsdom doesn't implement media playback
const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});

const SENSITIVE_ART = 'https://images.test/images/sens123.webp';
const SAFE_ART = 'https://images.test/images/safe456.webp';

let artworkUrl = SENSITIVE_ART;

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function radioState() {
	return {
		station_slug: 'loved',
		generated_at: new Date().toISOString(),
		progress_seconds: 10,
		current: {
			id: 1,
			title: 'a track',
			artist_handle: 'artist.test',
			artwork_url: artworkUrl,
			duration: 100,
			stream_url: 'https://audio.test/1.mp3'
		},
		rotation: []
	};
}

let component: Record<string, unknown> | null = null;

async function mountRadioEmbed(): Promise<HTMLImageElement> {
	const RadioEmbed = (await import('$lib/components/embed/RadioEmbed.svelte')).default;
	component = mount(RadioEmbed, { target: document.body });
	let img: HTMLImageElement | null = null;
	await vi.waitFor(() => {
		img = document.querySelector('img.art');
		expect(img).toBeTruthy();
	});
	return img!;
}

beforeAll(async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/moderation/sensitive-images')) {
				return jsonResponse({ image_ids: ['sens123'], urls: [] });
			}
			if (url.includes('/radio/stations')) {
				return jsonResponse({ stations: [{ slug: 'loved', name: 'loved', description: '' }] });
			}
			if (url.includes('/radio/state')) {
				return jsonResponse(radioState());
			}
			return jsonResponse({});
		})
	);
	// seed the registry the same way the root layout does (moderation.initialize → fetch)
	const { moderation } = await import('$lib/moderation.svelte');
	await moderation.fetch();
});

afterEach(() => {
	if (component) {
		unmount(component);
		component = null;
	}
	document.body.innerHTML = '';
	pageUrl.value = 'http://localhost/';
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
		pageUrl.value = 'http://localhost/?autoplay=1';
		await mountRadioEmbed();
		await vi.waitFor(() => expect(playSpy).toHaveBeenCalled());
	});

	it('stays paused without the param', async () => {
		artworkUrl = SAFE_ART;
		await mountRadioEmbed();
		expect(playSpy).not.toHaveBeenCalled();
	});
});
