import { describe, expect, it } from 'vitest';
import {
	PartAttemptError,
	planParts,
	uploadParts,
	UploadPartError,
	type PartSender,
	type UploadSessionState
} from './upload-session';

const session = (overrides: Partial<UploadSessionState> = {}): UploadSessionState => ({
	upload_id: 'u1',
	part_size_bytes: 4,
	part_count: 3,
	received_parts: [],
	...overrides
});

const file = new File([new Uint8Array(10)], 'song.wav');
const noSleep = () => Promise.resolve();

describe('planParts', () => {
	it('slices uniform parts with a shorter final part', () => {
		expect(planParts(10, 4, 3)).toEqual([
			{ partNumber: 1, start: 0, end: 4 },
			{ partNumber: 2, start: 4, end: 8 },
			{ partNumber: 3, start: 8, end: 10 }
		]);
	});
});

describe('uploadParts', () => {
	it('sends only the parts the server has not received and reports acknowledged bytes', async () => {
		const sent: number[] = [];
		const progress: number[] = [];
		const send: PartSender = async (url, body, options) => {
			sent.push(Number(url.split('/').pop()));
			options.onProgress(body.size);
		};
		await uploadParts({
			file,
			session: session({ received_parts: [2] }),
			send,
			sleep: noSleep,
			onProgress: (loaded, total) => {
				expect(total).toBe(10);
				progress.push(loaded);
			}
		});
		expect(sent.sort()).toEqual([1, 3]);
		expect(progress[0]).toBe(4);
		expect(progress.at(-1)).toBe(10);
	});

	it('retries a timed-out part with backoff and succeeds', async () => {
		const attempts = new Map<number, number>();
		const delays: number[] = [];
		const send: PartSender = async (url, body, options) => {
			const part = Number(url.split('/').pop());
			const n = (attempts.get(part) ?? 0) + 1;
			attempts.set(part, n);
			if (part === 2 && n < 3) throw new PartAttemptError({ kind: 'timeout' });
			options.onProgress(body.size);
		};
		await uploadParts({
			file,
			session: session(),
			send,
			sleep: async (ms) => {
				delays.push(ms);
			},
			onProgress: () => {}
		});
		expect(attempts.get(2)).toBe(3);
		expect(delays).toEqual([500, 1000]);
	});

	it('gives up on a client error without retrying', async () => {
		let calls = 0;
		const send: PartSender = async () => {
			calls++;
			throw new PartAttemptError({ kind: 'http', status: 409, detail: 'upload session is not open' });
		};
		await expect(
			uploadParts({ file, session: session(), send, sleep: noSleep, concurrency: 1, onProgress: () => {} })
		).rejects.toBeInstanceOf(UploadPartError);
		expect(calls).toBe(1);
	});

	it('surfaces the exhausted failure after the attempt budget', async () => {
		let calls = 0;
		const send: PartSender = async () => {
			calls++;
			throw new PartAttemptError({ kind: 'network' });
		};
		await expect(
			uploadParts({
				file,
				session: session({ part_count: 1, part_size_bytes: 10 }),
				send,
				sleep: noSleep,
				attempts: 2,
				onProgress: () => {}
			})
		).rejects.toMatchObject({ failure: { kind: 'network' }, partNumber: 1 });
		expect(calls).toBe(2);
	});
});
