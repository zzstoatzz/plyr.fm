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
let component: { save: () => Promise<string | null> } | undefined;
let dirty = false;

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
	dirty = false;
	component = mount(AlbumPublishingEditor, {
		target: document.body,
		props: {
			album,
			tracks,
			onchange,
			get dirty() {
				return dirty;
			},
			set dirty(value: boolean) {
				dirty = value;
			}
		}
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
/** the album page's single save action calls this; failures reject */
function save(): Promise<string | null> {
	if (!component) throw new Error('not mounted');
	return component.save();
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
		expect(dirty).toBe(true);
		expect(await save()).toBe('album settings saved');
		expect(onchange).toHaveBeenCalledWith('album', true);
		flushSync();
		expect(dirty).toBe(false);
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('PATCH');
		expect(requests[0].url).toContain('/albums/album?show_plylst=true');
	});
	it('reports clean once a draft is put back the way it was', () => {
		const { requests } = setup();
		expect(dirty).toBe(false);
		check('show plylst link');
		expect(dirty).toBe(true);
		check('show plylst link', false);
		expect(dirty).toBe(false);
		expect(requests).toHaveLength(0);
	});
	it('has no save button of its own; the page owns the one save action', () => {
		setup();
		expect(document.querySelectorAll('button')).toHaveLength(0);
	});
	it('resolves null without requests when nothing changed', async () => {
		const { requests } = setup();
		expect(await save()).toBeNull();
		expect(requests).toHaveLength(0);
	});
	it('preserves track overrides by default and waits for the publishing job', async () => {
		const { requests } = setup(publishingResponse);
		choose('settings', 'custom');
		choose('downloads', 'ask');
		expect(await save()).toBe('album defaults saved; 0 tracks updated');
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
		expect(await save()).toBe('album defaults saved; 1 track updated');
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
		await expect(save()).rejects.toThrow('could not save');
		flushSync();
		expect(document.querySelector('[role=alert]')?.textContent).toContain('could not save');
		expect(dirty).toBe(true);
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
		await expect(save()).rejects.toThrow();
		flushSync();
		expect(document.querySelector('[role=alert]')).not.toBeNull();
		expect(await save()).toBe('album settings saved');
		expect(onchange).toHaveBeenCalled();
		expect(requests.map((request) => request.method)).toEqual(['POST', 'GET', 'PATCH', 'PATCH']);
	});
	it('keeps the link unchanged if access changes fail', async () => {
		const { requests, onchange } = setup(async () =>
			Response.json({ detail: 'access refused' }, { status: 403 })
		);
		choose('settings', 'custom');
		check('show plylst link');
		await expect(save()).rejects.toThrow('access refused');
		flushSync();
		expect(document.querySelector('[role=alert]')?.textContent).toContain('access refused');
		expect(requests.map((request) => request.method)).toEqual(['POST']);
		expect(onchange).not.toHaveBeenCalled();
	});
});
