import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TrackEditForm from './TrackEditForm.svelte';
import { auth } from '$lib/auth.svelte';
import { COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
import type { Track } from '$lib/types';

const track = {
	id: 7,
	title: 'original title',
	artist: 'nate',
	artist_handle: 'nate.test',
	artist_did: 'did:plc:owner',
	file_id: 'audio',
	file_type: 'mp3',
	play_count: 0,
	copyright_song_uri: 'at://did:plc:owner/song/7',
	support_gate: { type: 'copyright' }
} satisfies Track;
let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	auth.user = null;
});

function mountEditor(editorTrack: Track = track, atprotofansEligible = false) {
	const onSaved = vi.fn();
	const onClose = vi.fn();
	const onDirtyChange = vi.fn();
	const component = mount(TrackEditForm, {
		target: document.body,
		props: { track: editorTrack, albums: [], atprotofansEligible, onSaved, onClose, onDirtyChange }
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	return { onSaved, onClose, onDirtyChange };
}

function editTitle(value: string): void {
	const input = document.querySelector<HTMLInputElement>('#edit-title');
	if (!input) throw new Error('title input missing');
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function submit(): void {
	document
		.querySelector('form')
		?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
}

describe('shared track editor', () => {
	it('preserves private files when editing public listening metadata', async () => {
		const streamTrack = { ...track, copyright_song_uri: null, support_gate: null, audio_storage: 'r2_private' as const, download_policy: 'off' };
		const requests: Request[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			if (request.url.includes('/recommended-tags')) return Response.json({ available: false, tags: [] });
			return Response.json({ ...streamTrack, title: 'new title' });
		});
		const { onSaved } = mountEditor(streamTrack, true);
		expect(document.body.textContent).toContain('download policy: off');
		expect(document.body.textContent).toContain('only supporters can play');
		editTitle('new title');
		submit();
		await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
		const saved = await requests.find((request) => request.method === 'PATCH')?.formData();
		expect(saved?.get('support_gate')).toBe('null');
		expect(saved?.has('download_policy')).toBe(false);
	});

	it('saves ordinary details without overwriting existing copyright records', async () => {
		const requests: Request[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			if (request.url.includes('/recommended-tags'))
				return Response.json({ available: false, tags: [] });
			return Response.json({ ...track, title: 'new title' });
		});
		const { onSaved, onClose, onDirtyChange } = mountEditor();
		editTitle('new title');
		expect(onDirtyChange).toHaveBeenLastCalledWith(true);
		submit();
		await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...track, title: 'new title' }));
		const writes = requests.filter((request) => request.method !== 'GET');
		expect(writes.map((request) => request.method)).toEqual(['PATCH']);
		expect(writes[0]?.url).toMatch(/\/tracks\/7$/);
		const saved = await writes[0]?.formData();
		expect(saved?.get('title')).toBe('new title');
		expect(saved?.has('support_gate')).toBe(false);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('keeps the draft and shows the server error when saving fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			if (request.method === 'PATCH')
				return Response.json({ detail: 'could not save track' }, { status: 503 });
			return Response.json({ available: false, tags: [] });
		});
		const { onSaved, onClose } = mountEditor();
		editTitle('unsaved title');
		submit();
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toBe('could not save track')
		);
		expect(document.querySelector<HTMLInputElement>('#edit-title')?.value).toBe('unsaved title');
		expect(onSaved).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
			false
		);
	});
	it('keeps the editor open when copyright removal fails after metadata saved', async () => {
		auth.user = {
			did: track.artist_did,
			handle: track.artist_handle,
			linked_accounts: [],
			enabled_flags: [COPYRIGHT_PARADIGM_FLAG]
		};
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			if (request.method === 'DELETE')
				return Response.json({ detail: 'PDS unavailable' }, { status: 503 });
			if (request.method === 'PATCH') return Response.json(track);
			return Response.json({ available: false, tags: [] });
		});
		const { onSaved, onClose } = mountEditor();
		const licensing = [...document.querySelectorAll('label')]
			.find((label) => label.textContent?.includes('copyright licensing'))
			?.querySelector('input');
		if (!licensing) throw new Error('copyright toggle missing');
		licensing.click();
		flushSync();
		submit();
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain(
				'copyright could not be cleared'
			)
		);
		expect(onSaved).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe('suggested tag feedback', () => {
	it.each([
		[{ available: false, tags: [] }, 'suggested tags unavailable'],
		[{ available: true, tags: [] }, 'no new suggested tags']
	])('explains an empty response %j', async (response, message) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response));
		mountEditor();
		await vi.waitFor(() => expect(document.body.textContent).toContain(message));
	});

	it('retries a failed request and lets the owner select the resulting tag', async () => {
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(
				Response.json({ available: true, tags: [{ name: 'Drone', score: 0.8 }] })
			);
		mountEditor();
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain('could not load suggested tags')
		);
		const retry = [...document.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'retry'
		);
		if (!retry) throw new Error('retry button missing');
		retry.click();
		await vi.waitFor(() => expect(document.body.textContent).toContain('+ Drone'));
		expect(fetch).toHaveBeenCalledTimes(2);
		const suggestion = [...document.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('+ Drone')
		);
		if (!suggestion) throw new Error('suggestion missing');
		suggestion.click();
		flushSync();
		expect(document.body.textContent).toContain('no new suggested tags');
		expect(document.body.textContent).not.toContain('could not load suggested tags');
		expect(document.querySelector('#edit-tags')?.parentElement?.textContent).toContain('drone');
	});
});
