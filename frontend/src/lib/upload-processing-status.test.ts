import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploader } from './uploader.svelte';
import type { StagedTransport } from './staged-transfer.svelte';

class UploadEvents {
	static latest: UploadEvents | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;
	constructor() {
		UploadEvents.latest = this;
	}
	close(): void {
		this.closed = true;
	}
}

afterEach(() => {
	uploader.activeUploads.clear();
	UploadEvents.latest = null;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('upload processing failure', () => {
	it.each(['worker', 'connection'])('reports a %s failure to the form', async (failure) => {
		vi.stubGlobal('EventSource', UploadEvents);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ upload_id: 'upload' }));
		const upload = { upload_id: 'upload', part_size_bytes: 4, part_count: 1, received_parts: [] };
		const transport: StagedTransport = {
			start: async () => upload,
			resume: async () => upload,
			parts: async () => undefined
		};
		const staged = uploader.stage(new File(['data'], 'track.flac'), transport);
		const failed = vi.fn();
		uploader.upload(staged, 'track', '', [], null, [], null, false, '', undefined, {
			onError: failed
		});
		await vi.waitFor(() => expect(UploadEvents.latest).not.toBeNull());
		if (failure === 'worker') {
			UploadEvents.latest?.onmessage?.(
				new MessageEvent('message', {
					data: JSON.stringify({ status: 'failed', error: 'could not publish track' })
				})
			);
			expect(failed).toHaveBeenCalledWith('could not publish track');
		} else {
			UploadEvents.latest?.onerror?.();
			expect(failed).toHaveBeenCalledWith('connection lost — check Portal before retrying');
		}
		expect(UploadEvents.latest?.closed).toBe(true);
		expect(uploader.activeUploads.size).toBe(0);
	});
});

it.each([false, true])(
	'sends plyr-only storage acceptance only when chosen (%s)',
	async (accepted) => {
		vi.stubGlobal('EventSource', UploadEvents);
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(Response.json({ upload_id: 'upload' }));
		const upload = { upload_id: 'upload', part_size_bytes: 4, part_count: 1, received_parts: [] };
		const transport: StagedTransport = {
			start: async () => upload,
			resume: async () => upload,
			parts: async () => undefined
		};
		const staged = uploader.stage(new File(['data'], 'track.mp3'), transport);
		uploader.upload(
			staged,
			'track',
			'',
			[],
			null,
			[],
			null,
			false,
			'',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			[],
			accepted
		);
		await vi.waitFor(() => expect(UploadEvents.latest).not.toBeNull());
		const body = fetch.mock.calls[0]?.[1]?.body;
		if (!(body instanceof FormData)) throw new Error('upload form missing');
		expect(body.get('accept_plyr_storage')).toBe(accepted ? 'true' : null);
		UploadEvents.latest?.onmessage?.(
			new MessageEvent('message', {
				data: JSON.stringify({ status: 'failed', error: 'test finished' })
			})
		);
	}
);

it('returns a scope refusal to the form and clears the active upload', async () => {
	const fetch = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(Response.json({ detail: 'permissioned_scope_required' }, { status: 403 }));
	const upload = { upload_id: 'upload', part_size_bytes: 4, part_count: 1, received_parts: [] };
	const transport: StagedTransport = {
		start: async () => upload,
		resume: async () => upload,
		parts: async () => undefined
	};
	const staged = uploader.stage(new File(['data'], 'track.mp3'), transport);
	const failed = vi.fn();
	uploader.upload(staged, 'track', '', [], null, [], null, false, '', undefined, {
		onError: failed
	});
	await vi.waitFor(() =>
		expect(failed).toHaveBeenCalledWith('approve PDS audio storage, then try uploading again')
	);
	expect(uploader.activeUploads.size).toBe(0);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(UploadEvents.latest).toBeNull();
});
