import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AlbumPublishingEditor from './AlbumPublishingEditor.svelte';
import { preferences, DEFAULT_PREFERENCES } from '$lib/preferences.svelte';
import { defaultPublishing } from '$lib/publishing';
import type { AlbumMetadata, Track } from '$lib/types';

const album = {
	id: 'album',
	title: 'chromatic drones',
	slug: 'drones',
	artist: 'nate',
	artist_handle: 'nate.test',
	artist_did: 'did:plc:owner',
	track_count: 1,
	total_plays: 0,
	show_plylst: false,
	publishing_defaults: null
} satisfies AlbumMetadata;
const tracks = [
	{
		id: 1,
		title: 'drone',
		artist: 'nate',
		artist_handle: 'nate.test',
		file_id: 'audio',
		file_type: 'mp3',
		play_count: 0,
		policy_origin: 'track',
		publishing: defaultPublishing()
	}
] satisfies Track[];
let component: object | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	preferences.data = null;
	vi.unstubAllGlobals();
});

function setup(respond: (request: Request) => Promise<Response> = async () => Response.json({})) {
	preferences.data = globalThis.structuredClone(DEFAULT_PREFERENCES);
	const requests: Request[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			return respond(request);
		})
	);
	const onchange = vi.fn<(id: string, enabled: boolean) => void>();
	component = mount(AlbumPublishingEditor, {
		target: document.body,
		props: { album, tracks, onchange }
	});
	flushSync();
	return { requests, onchange };
}
function checkbox(name: string): HTMLInputElement {
	const input = [...document.querySelectorAll('input')].find(
		(input) =>
			input.getAttribute('aria-label') === name || input.parentElement?.textContent?.includes(name)
	);
	if (!input) throw new Error(`missing ${name}`);
	return input;
}
function check(name: string, value = true): void {
	const input = checkbox(name);
	input.checked = value;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
function choose(name: string, value: string): void {
	const select = [...document.querySelectorAll('select')].find((select) =>
		select.parentElement?.textContent?.trim().startsWith(name)
	);
	if (!select) throw new Error(`missing ${name}`);
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
function click(text: string): void {
	const button = [...document.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === text
	);
	if (!button) throw new Error(`missing ${text}`);
	button.click();
	flushSync();
}
function publishingResponse(request: Request): Promise<Response> {
	return Promise.resolve(
		request.url.includes('/publishing-jobs/')
			? Response.json({ status: 'completed', updated_track_ids: [1], failed_track_ids: [] })
			: Response.json({ job_id: 'job' })
	);
}

describe('compact album settings', () => {
	it('keeps the sections folded and saves only the link after an explicit save', async () => {
		const { requests, onchange } = setup();
		expect([...document.querySelectorAll('details')].every((details) => !details.open)).toBe(true);
		check('show plylst link');
		expect(requests).toHaveLength(0);
		click('save changes');
		await vi.waitFor(() => expect(onchange).toHaveBeenCalledWith('album', true));
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('PATCH');
		expect(requests[0].url).toContain('/albums/album?show_plylst=true');
	});
	it('cancels drafts without changing album or track access', () => {
		const { requests } = setup();
		choose('settings', 'custom');
		choose('who can listen', 'owner');
		check('show plylst link');
		click('cancel');
		expect(requests).toHaveLength(0);
		expect(checkbox('show plylst link').checked).toBe(false);
		expect(document.body.textContent).toContain('anyone can listen · downloads allowed');
		expect(document.body.textContent).toContain('no changes');
	});
	it('preserves track overrides by default and waits for the publishing job', async () => {
		const { requests } = setup(publishingResponse);
		choose('settings', 'custom');
		choose('downloads', 'ask');
		click('save changes');
		await vi.waitFor(() => expect(document.body.textContent).toContain('0 tracks updated'));
		expect(await requests[0].json()).toEqual({
			settings: {
				...defaultPublishing(),
				access: { ...defaultPublishing().access, downloads: 'ask' }
			},
			replace_overrides: false
		});
		expect(requests.map((request) => request.method)).toEqual(['POST', 'GET']);
	});
	it('replaces track overrides only when explicitly selected', async () => {
		const { requests } = setup(publishingResponse);
		check('also replace');
		click('save changes');
		await vi.waitFor(() => expect(document.body.textContent).toContain('1 track updated'));
		expect(await requests[0].json()).toEqual({ settings: null, replace_overrides: true });
	});
	it('normalizes restricted listening and disables downloads', () => {
		setup();
		choose('settings', 'custom');
		choose('who can listen', 'owner');
		const download = [...document.querySelectorAll('select')].find((select) =>
			select.parentElement?.textContent?.trim().startsWith('downloads')
		);
		expect(download?.value).toBe('off');
		expect(download?.disabled).toBe(true);
	});
	it('retains an unsaved link choice after refusal so the owner can retry', async () => {
		const { onchange } = setup(async () => Response.json({}, { status: 403 }));
		check('show plylst link');
		click('save changes');
		await vi.waitFor(() =>
			expect(document.querySelector('[role=alert]')?.textContent).toContain('could not save')
		);
		expect(checkbox('show plylst link').checked).toBe(true);
		expect(onchange).not.toHaveBeenCalled();
	});
	it('does not resubmit successful access changes when retrying a failed link save', async () => {
		let refused = false;
		const { requests, onchange } = setup(async (request) => {
			if (request.method === 'PATCH' && !refused) {
				refused = true;
				return Response.json({}, { status: 403 });
			}
			return publishingResponse(request);
		});
		choose('settings', 'custom');
		choose('downloads', 'off');
		check('show plylst link');
		click('save changes');
		await vi.waitFor(() => expect(document.querySelector('[role=alert]')).not.toBeNull());
		expect(document.body.textContent).toContain('album defaults saved');
		click('save changes');
		await vi.waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(requests.map((request) => request.method)).toEqual(['POST', 'GET', 'PATCH', 'PATCH']);
	});
	it('keeps the link unchanged if access changes fail', async () => {
		const { requests, onchange } = setup(async () =>
			Response.json({ detail: 'access refused' }, { status: 403 })
		);
		choose('settings', 'custom');
		check('show plylst link');
		click('save changes');
		await vi.waitFor(() =>
			expect(document.querySelector('[role=alert]')?.textContent).toContain('access refused')
		);
		expect(requests.map((request) => request.method)).toEqual(['POST']);
		expect(onchange).not.toHaveBeenCalled();
	});
});
