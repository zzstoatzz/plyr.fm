/**
 * resumable track upload transport: start → parts → finish.
 *
 * the file goes up as fixed-size parts (`PUT /tracks/uploads/{id}/parts/{n}`),
 * a few in flight at a time. each part is its own short request with its own
 * timeout and retry budget, so a slow transfer is never one long request that
 * a fixed deadline can kill, and progress is measured from bytes the server
 * has actually acknowledged. `finish` sends the metadata and returns the
 * `upload_id` the processing SSE stream is keyed on.
 */

import { API_URL } from './config';

export const PART_CONCURRENCY = 3;
export const PART_TIMEOUT_MS = 120_000;
export const PART_ATTEMPTS = 5;
const RETRY_BASE_MS = 500;

export interface UploadSessionState {
	upload_id: string;
	part_size_bytes: number;
	part_count: number;
	received_parts: number[];
}

export interface PartPlan {
	partNumber: number;
	start: number;
	end: number;
}

export type PartFailure =
	| { kind: 'network' }
	| { kind: 'timeout' }
	| { kind: 'http'; status: number; detail: string | null };

/** what a single part attempt rejects with; `uploadParts` decides whether to retry. */
export class PartAttemptError extends Error {
	readonly failure: PartFailure;

	constructor(failure: PartFailure) {
		super(`part attempt failed: ${failure.kind}`);
		this.failure = failure;
	}
}

export class UploadPartError extends Error {
	readonly failure: PartFailure;
	readonly partNumber: number;

	constructor(partNumber: number, failure: PartFailure) {
		super(`part ${partNumber} failed: ${failure.kind}`);
		this.failure = failure;
		this.partNumber = partNumber;
	}
}

/** slice boundaries for every part; the last part is the remainder. */
export function planParts(sizeBytes: number, partSizeBytes: number, partCount: number): PartPlan[] {
	const plans: PartPlan[] = [];
	for (let partNumber = 1; partNumber <= partCount; partNumber++) {
		const start = (partNumber - 1) * partSizeBytes;
		plans.push({ partNumber, start, end: Math.min(start + partSizeBytes, sizeBytes) });
	}
	return plans;
}

function retryDelayMs(attempt: number): number {
	return RETRY_BASE_MS * 2 ** (attempt - 1);
}

function isRetryable(failure: PartFailure): boolean {
	if (failure.kind !== 'http') return true;
	return failure.status >= 500 || failure.status === 429 || failure.status === 408;
}

function parseSessionState(session: UploadSessionState): UploadSessionState {
	const { upload_id, part_size_bytes, part_count, received_parts } = session;
	if (
		upload_id == null ||
		upload_id === '' ||
		part_size_bytes == null ||
		!Number.isFinite(part_size_bytes) ||
		part_count == null ||
		!Number.isFinite(part_count) ||
		!Array.isArray(received_parts)
	) {
		throw new Error('malformed upload session');
	}
	return { upload_id, part_size_bytes, part_count, received_parts };
}

/** FastAPI's `detail` is a string for every error we raise; 422s carry a list. */
interface ErrorBody {
	detail?: string | object;
}

function detailOf(body: ErrorBody): string | null {
	return body.detail == null || body.detail instanceof Object ? null : body.detail;
}

async function errorDetail(response: Response): Promise<string | null> {
	try {
		const body: ErrorBody = await response.json();
		return detailOf(body);
	} catch {
		return null;
	}
}

/** an HTTP error from `start` or `finish`, carrying the server's `detail`. */
export class UploadSessionHttpError extends Error {
	readonly status: number;
	readonly detail: string | null;

	constructor(status: number, detail: string | null) {
		super(detail ?? `upload request failed (${status})`);
		this.status = status;
		this.detail = detail;
	}
}

export async function startUploadSession(file: File): Promise<UploadSessionState> {
	const response = await fetch(`${API_URL}/tracks/uploads`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ filename: file.name, size_bytes: file.size })
	});
	if (!response.ok) {
		throw new UploadSessionHttpError(response.status, await errorDetail(response));
	}
	return parseSessionState(await response.json());
}

export async function finishUploadSession(uploadId: string, form: FormData): Promise<string> {
	const response = await fetch(`${API_URL}/tracks/uploads/${uploadId}/finish`, {
		method: 'POST',
		credentials: 'include',
		body: form
	});
	if (!response.ok) {
		throw new UploadSessionHttpError(response.status, await errorDetail(response));
	}
	const body: { upload_id?: string } = await response.json();
	if (body.upload_id == null || body.upload_id === '') throw new Error('malformed upload response');
	return body.upload_id;
}

export interface SendPartOptions {
	timeoutMs: number;
	onProgress: (loadedBytes: number) => void;
	signal?: AbortSignal;
}

/** one part over XHR — the only browser transport with upload progress events. */
export function sendPart(url: string, body: Blob, options: SendPartOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url);
		xhr.withCredentials = true;
		xhr.timeout = options.timeoutMs;
		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) options.onProgress(event.loaded);
		});
		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				options.onProgress(body.size);
				resolve();
				return;
			}
			let detail: string | null = null;
			try {
				const parsed: ErrorBody = JSON.parse(xhr.responseText);
				detail = detailOf(parsed);
			} catch {
				detail = null;
			}
			reject(new PartAttemptError({ kind: 'http', status: xhr.status, detail }));
		});
		xhr.addEventListener('error', () => reject(new PartAttemptError({ kind: 'network' })));
		xhr.addEventListener('timeout', () => reject(new PartAttemptError({ kind: 'timeout' })));
		xhr.addEventListener('abort', () => reject(new PartAttemptError({ kind: 'network' })));
		options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
		xhr.send(body);
	});
}

export type PartSender = typeof sendPart;

export interface UploadPartsOptions {
	file: File;
	session: UploadSessionState;
	onProgress: (loadedBytes: number, totalBytes: number) => void;
	send?: PartSender;
	concurrency?: number;
	attempts?: number;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
	signal?: AbortSignal;
}

/**
 * send every part the server has not already received, `concurrency` at a
 * time, retrying each part with exponential backoff. progress is the sum of
 * acknowledged bytes plus the in-flight bytes of parts still sending.
 */
export async function uploadParts(options: UploadPartsOptions): Promise<void> {
	const {
		file,
		session,
		onProgress,
		send = sendPart,
		concurrency = PART_CONCURRENCY,
		attempts = PART_ATTEMPTS,
		timeoutMs = PART_TIMEOUT_MS,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		signal
	} = options;
	const received = new Set(session.received_parts);
	const plans = planParts(file.size, session.part_size_bytes, session.part_count);
	const pending = plans.filter((plan) => !received.has(plan.partNumber));
	const loadedByPart = new Map<number, number>();
	for (const plan of plans) {
		if (received.has(plan.partNumber)) loadedByPart.set(plan.partNumber, plan.end - plan.start);
	}
	const report = () => {
		let loaded = 0;
		for (const bytes of loadedByPart.values()) loaded += bytes;
		onProgress(loaded, file.size);
	};
	report();

	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < pending.length) {
			if (signal?.aborted) throw new UploadPartError(0, { kind: 'network' });
			const plan = pending[next++];
			const body = file.slice(plan.start, plan.end);
			const url = `${API_URL}/tracks/uploads/${session.upload_id}/parts/${plan.partNumber}`;
			for (let attempt = 1; ; attempt++) {
				try {
					await send(url, body, {
						timeoutMs,
						signal,
						onProgress: (bytes) => {
							loadedByPart.set(plan.partNumber, bytes);
							report();
						}
					});
					break;
				} catch (error) {
					const partFailure: PartFailure =
						error instanceof PartAttemptError ? error.failure : { kind: 'network' };
					loadedByPart.set(plan.partNumber, 0);
					report();
					if (attempt >= attempts || !isRetryable(partFailure) || signal?.aborted) {
						throw new UploadPartError(plan.partNumber, partFailure);
					}
					await sleep(retryDelayMs(attempt));
				}
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
}
