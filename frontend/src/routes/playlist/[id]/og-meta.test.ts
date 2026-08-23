// regression: the SSR branch of the playlist load rebuilds the playlist
// object field-by-field from /meta; dropping a field there silently strips
// it from the OG head render (preview_thumbnails went missing → imageless
// link previews for composite covers).
import { describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import type { LoadEvent } from '@sveltejs/kit';
import type { Playlist } from '$lib/types';

import { load } from './+page';

const meta: Playlist = {
	id: 'p1',
	name: 'ambient',
	owner_did: 'did:plc:owner',
	owner_handle: 'owner.test',
	track_count: 4,
	show_on_profile: false,
	atproto_record_uri: null,
	is_private: false,
	created_at: '2026-01-01T00:00:00Z',
	preview_thumbnails: ['a.webp', 'b.webp', 'c.webp', 'd.webp']
};

function loadEvent(playlistMeta: Playlist | null): LoadEvent {
	const span = trace.getTracer('test').startSpan('sveltekit.handle.root');
	return {
		tracing: { enabled: false, root: span, current: span },
		params: { id: 'p1' },
		data: { playlistMeta },
		url: new URL('http://localhost/playlist/p1'),
		route: { id: '/playlist/[id]' },
		fetch,
		setHeaders: () => {},
		depends: () => {},
		parent: () => Promise.resolve({}),
		untrack: (fn) => fn()
	};
}

describe('playlist SSR load', () => {
	it('carries preview_thumbnails through to the head data', async () => {
		const result = await load(loadEvent(meta), true);

		expect(result.playlist.preview_thumbnails).toEqual(['a.webp', 'b.webp', 'c.webp', 'd.webp']);
	});

	it('defaults to no previews when meta is unavailable', async () => {
		const result = await load(loadEvent(null), true);

		expect(result.playlist.preview_thumbnails).toEqual([]);
	});
});


it('the default follows $app/environment, not a hardwired branch', async () => {
	// vitest is a browser env, so load(event) with no override must take the
	// client branch and fetch — the wiring the explicit-arg tests bypass
	const fetchSpy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(JSON.stringify({ ...meta, tracks: [] })));
	try {
		const result = await load(loadEvent(meta));
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(result.playlist.name).toBe(meta.name);
	} finally {
		fetchSpy.mockRestore();
	}
});
