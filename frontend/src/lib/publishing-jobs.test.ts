import { afterEach, expect, it, vi } from 'vitest';
import { changePublishing } from './publishing-jobs';

afterEach(() => vi.restoreAllMocks());

it('preserves the partial-save explanation when album job submission fails', async () => {
	const detail =
		'album defaults saved; track updates could not be confirmed. refresh before retrying.';
	const fetcher = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(Response.json({ detail }, { status: 503 }));
	await expect(changePublishing('/albums/album/publishing', { settings: null })).rejects.toThrow(
		detail
	);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps a usable failure message when a proxy returns HTML', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('<html>unavailable</html>', { status: 502 })
	);
	await expect(changePublishing('/albums/album/publishing', { settings: null })).rejects.toThrow(
		'could not start access change — retry'
	);
});
