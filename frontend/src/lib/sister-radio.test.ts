import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountRadio } from '../../vendor/sister-radio/host';
import { radioIntegration } from './sister-radio';
import type { RadioState, RadioTrack } from './radio.svelte';

const track: RadioTrack = {
	id: 12,
	title: 'A real catalog track',
	artist: 'Artist',
	artist_handle: 'artist.test',
	artist_did: 'did:plc:artist',
	stream_url: '/tracks/12/stream',
	file_type: 'mp3',
	duration: 180,
	artwork_url: '/cover.jpg',
	thumbnail_url: null,
	atproto_record_uri: null,
	atproto_record_cid: null,
	created_at: '2026-09-27T00:00:00Z',
	tags: [],
	like_count: 0,
	play_count: 1,
	liked: false
};
const state: RadioState = {
	station: 'loved',
	station_slug: 'loved',
	generated_at: track.created_at,
	loop_duration_seconds: 360,
	current_index: 0,
	current_started_at: track.created_at,
	current_ends_at: null,
	progress_seconds: 30,
	current: track,
	up_next: [{ ...track, id: 13, title: 'Next track' }],
	rotation: [track]
};
function fixture() {
	return {
		state,
		stations: ['loved', 'fresh', 'firehose'].map((slug) => ({
			slug,
			name: slug,
			description: slug,
			is_default: slug === 'loved'
		})),
		selected: 'loved',
		playing: false,
		liked: false,
		position: 30,
		volume: 0.5,
		loading: false,
		error: null,
		listeners: { count: 0, listeners: [] },
		origin: 'https://stg.plyr.fm',
		cover: () => '/cover.jpg',
		play: vi.fn(),
		pause: vi.fn(),
		setVolume: vi.fn(),
		selectStation: vi.fn(),
		likeTrack: vi.fn()
	};
}
let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe('the actual sister-radio host', () => {
	it('renders the fork and delegates playback/stations without its own audio or network', async () => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
				unobserve() {}
			}
		);
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {}
		}));
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const input = fixture();
		const host = document.createElement('div');
		document.body.append(host);
		const mounted = mountRadio(host, radioIntegration(input));
		dispose = mounted.dispose;
		await Promise.resolve();
		const root = host.shadowRoot!;
		const button = (label: string) =>
			root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
		expect(root.querySelector('.radio-page')).not.toBeNull();
		expect(root.textContent).toContain(track.title);
		expect(root.querySelector('audio')).toBeNull();
		button('listen live').click();
		expect(input.play).toHaveBeenCalledOnce();
		mounted.update(radioIntegration({ ...input, playing: true }));
		button('pause').click();
		expect(input.pause).toHaveBeenCalledOnce();
		mounted.update(radioIntegration({ ...input, liked: true }));
		expect(button('unlike this track').getAttribute('aria-pressed')).toBe('true');
		expect(button('unlike this track').querySelector('svg')?.getAttribute('fill')).toBe(
			'currentColor'
		);
		button('unlike this track').click();
		expect(input.likeTrack).toHaveBeenCalledOnce();
		mounted.update(radioIntegration({ ...input, liked: false }));
		expect(button('like this track').getAttribute('aria-pressed')).toBe('false');
		button('tune in to fresh').click();
		expect(input.selectStation).toHaveBeenCalledWith('fresh');
		mounted.update(
			radioIntegration({
				...input,
				listeners: {
					count: 1,
					listeners: [
						{
							did: 'did:plc:listener',
							handle: 'listener.test',
							display_name: 'Listener',
							avatar_url: '/listener.jpg'
						}
					]
				}
			})
		);
		expect(root.querySelector('img[src="/listener.jpg"]')).not.toBeNull();
		expect(root.querySelector('img[src="/cover.jpg"]')).not.toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		const keys = vi.fn();
		document.addEventListener('keydown', keys);
		root
			.querySelector('input')!
			.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true })
			);
		expect(keys).not.toHaveBeenCalled();
		document.removeEventListener('keydown', keys);
		mounted.update(radioIntegration({ ...input, position: 31 }));
		expect(root.querySelector('.art-crt-volume')).toBeNull();
		mounted.update(
			radioIntegration({ ...input, state: { ...state, current: null, up_next: [], rotation: [] } })
		);
		expect(root.textContent).toContain('off air');
		expect(root.querySelector('img[src="/cover.jpg"]')).toBeNull();
	});
	it('rejects outside stations and preserves zero versus unknown listener counts', () => {
		const input = fixture();
		const integration = radioIntegration(input);
		integration.selectStation('https://radio.example/');
		expect(input.selectStation).not.toHaveBeenCalled();
		expect(integration.listenerCount).toBe(0);
		expect(radioIntegration({ ...input, listeners: null }).listenerCount).toBeNull();
		expect(radioIntegration({ ...input, cover: () => '' }).snapshot?.currentSong?.hasCover).toBe(
			false
		);
	});
});
