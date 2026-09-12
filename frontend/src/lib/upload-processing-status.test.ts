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
