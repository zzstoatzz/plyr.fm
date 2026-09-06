import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploader, type AudioReplacementStatus } from './uploader.svelte';

class ReplacementRequest extends EventTarget {
	static latest: ReplacementRequest;
	upload = new EventTarget();
	status = 200;
	statusText = 'OK';
	responseText = JSON.stringify({ upload_id: 'replacement' });
	withCredentials = false;
	timeout = 0;
	constructor() {
		super();
		ReplacementRequest.latest = this;
	}
	open(): void {
		/* No network is needed for transport events. */
	}
	send(): void {
		/* The test controls upload progress and completion. */
	}
}

class ReplacementEvents {
	static latest: ReplacementEvents;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;
	constructor() {
		ReplacementEvents.latest = this;
	}
	close(): void {
		this.closed = true;
	}
}

afterEach(() => {
	uploader.activeUploads.clear();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function begin(onComplete?: () => Promise<void>): AudioReplacementStatus[] {
	vi.stubGlobal('XMLHttpRequest', ReplacementRequest);
	vi.stubGlobal('EventSource', ReplacementEvents);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({ tracks: [], total: 0, has_more: false })
	);
	const statuses: AudioReplacementStatus[] = [];
	uploader.replaceAudio(
		7,
		new File(['audio'], 'replacement.mp3'),
		'track',
		onComplete,
		(status) => {
			statuses.push(status);
		}
	);
	return statuses;
}

describe('audio replacement inline status', () => {
	it('reports upload, processing, success, and a rejected refresh without rejecting globally', async () => {
		const statuses = begin(async () => {
			throw new Error('refresh unavailable');
		});
		expect(statuses.at(-1)?.message).toBe('uploading replacement audio…');
		ReplacementRequest.latest.upload.dispatchEvent(
			new ProgressEvent('progress', { lengthComputable: true, loaded: 5, total: 10 })
		);
		expect(statuses.at(-1)?.message).toContain('50%');
		ReplacementRequest.latest.dispatchEvent(new Event('load'));
		expect(statuses.at(-1)?.message).toBe('processing replacement audio…');
		ReplacementEvents.latest.onmessage?.(
			new MessageEvent('message', {
				data: JSON.stringify({
					status: 'processing',
					message: 'optimizing audio',
					server_progress_pct: 75
				})
			})
		);
		expect(statuses.at(-1)?.message).toBe('optimizing audio (75%)');
		ReplacementEvents.latest.onmessage?.(
			new MessageEvent('message', { data: JSON.stringify({ status: 'completed' }) })
		);
		expect(statuses.at(-1)).toEqual({ type: 'success', message: 'audio replaced' });
		await vi.waitFor(() =>
			expect(statuses.at(-1)).toEqual({
				type: 'warning',
				message: 'audio replaced — reload to see the update'
			})
		);
		expect(ReplacementEvents.latest.closed).toBe(true);
	});

	it('reports the HTTP error to the inline consumer', () => {
		const statuses = begin();
		ReplacementRequest.latest.status = 403;
		ReplacementRequest.latest.responseText = JSON.stringify({ detail: 'not your track' });
		ReplacementRequest.latest.dispatchEvent(new Event('load'));
		expect(statuses.at(-1)).toEqual({ type: 'error', message: 'not your track' });
	});

	it('reports malformed progress and closes the failed stream', () => {
		const statuses = begin();
		ReplacementRequest.latest.dispatchEvent(new Event('load'));
		ReplacementEvents.latest.onmessage?.(new MessageEvent('message', { data: 'invalid json' }));
		expect(statuses.at(-1)?.type).toBe('error');
		expect(ReplacementEvents.latest.closed).toBe(true);
	});
});
