import { describe, expect, it } from 'vitest';
import { StagedTransfer, type StagedTransport } from './staged-transfer.svelte';
import { UploadPartError, type UploadSessionState } from './upload-session';

const file = new File([new Uint8Array(10)], 'song.wav');

const state = (received: number[] = []): UploadSessionState => ({
	upload_id: 'u1',
	part_size_bytes: 4,
	part_count: 3,
	received_parts: received
});

const describe_ = (failure: Error, percent: number) => `${failure.message} at ${percent}%`;

describe('StagedTransfer', () => {
	it('opens a session, sends the parts and settles with the upload id', async () => {
		const seen: string[] = [];
		const transport: StagedTransport = {
			start: async () => {
				seen.push('start');
				return state();
			},
			resume: async () => {
				seen.push('resume');
				return state();
			},
			parts: async ({ onProgress }) => {
				seen.push('parts');
				onProgress(4, 10);
				onProgress(10, 10);
			}
		};
		const staged = new StagedTransfer(file, transport, describe_);
		expect(staged.status).toBe('opening');

		expect(await staged.whenTransferred()).toBe('u1');
		expect(staged.status).toBe('transferred');
		expect(staged.loaded).toBe(10);
		expect(staged.progressPercent).toBe(100);
		expect(seen).toEqual(['start', 'parts']);
	});

	it('records a described failure and resumes from the parts the server holds on retry', async () => {
		let attempt = 0;
		const sessions: UploadSessionState[] = [];
		const transport: StagedTransport = {
			start: async () => state(),
			resume: async (uploadId) => {
				expect(uploadId).toBe('u1');
				return state([1, 2]);
			},
			parts: async ({ session, onProgress }) => {
				sessions.push(session);
				attempt++;
				if (attempt === 1) {
					onProgress(4, 10);
					throw new UploadPartError(2, { kind: 'network' });
				}
				onProgress(10, 10);
			}
		};
		const staged = new StagedTransfer(file, transport, describe_);

		await expect(staged.whenTransferred()).rejects.toBeInstanceOf(UploadPartError);
		expect(staged.status).toBe('failed');
		expect(staged.error).toBe('part 2 failed: network at 40%');

		staged.retry();
		expect(staged.status).toBe('opening');
		expect(await staged.whenTransferred()).toBe('u1');
		expect(staged.error).toBeNull();
		expect(sessions.map((s) => s.received_parts)).toEqual([[], [1, 2]]);
	});

	it('retry is a no-op while a transfer is still moving', async () => {
		let starts = 0;
		const transport: StagedTransport = {
			start: async () => {
				starts++;
				return state();
			},
			resume: async () => state(),
			parts: async () => {}
		};
		const staged = new StagedTransfer(file, transport, describe_);
		staged.retry();
		await staged.whenTransferred();
		expect(starts).toBe(1);
	});

	it('abort reaches the part sender through the signal', async () => {
		let aborted = false;
		const transport: StagedTransport = {
			start: async () => state(),
			resume: async () => state(),
			parts: ({ signal }) =>
				new Promise((_, reject) => {
					signal?.addEventListener('abort', () => {
						aborted = true;
						reject(new UploadPartError(1, { kind: 'network' }));
					});
				})
		};
		const staged = new StagedTransfer(file, transport, describe_);
		while (staged.status !== 'transferring') await Promise.resolve();
		staged.abort();
		await expect(staged.whenTransferred()).rejects.toBeInstanceOf(UploadPartError);
		expect(aborted).toBe(true);
		expect(staged.status).toBe('failed');
	});
});
