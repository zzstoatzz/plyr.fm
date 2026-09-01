/**
 * a file moving into a resumable upload session ahead of the form.
 *
 * the bytes start travelling the moment a file is chosen and land in plyr's
 * staging storage; nothing is published, and nothing reaches the PDS, until
 * `finish` is called with the form. a dropped transfer resumes from the parts
 * the server already holds, and a re-selected or abandoned file is simply
 * aborted — the server reaps the open session on its own schedule.
 */

import {
	getUploadSession,
	startUploadSession,
	uploadParts,
	type UploadPartsOptions,
	type UploadSessionState
} from './upload-session';

export interface StagedTransport {
	start: (file: File) => Promise<UploadSessionState>;
	resume: (uploadId: string) => Promise<UploadSessionState>;
	parts: (options: UploadPartsOptions) => Promise<void>;
}

export const sessionTransport: StagedTransport = {
	start: startUploadSession,
	resume: getUploadSession,
	parts: uploadParts
};

export type TransferStatus = 'opening' | 'transferring' | 'transferred' | 'failed';

/** copy for a failed attempt; null when the failure was handled by a redirect. */
export type FailureDescriber = (failure: Error, progressPercent: number) => string | null;

export class StagedTransfer {
	readonly file: File;
	status = $state<TransferStatus>('opening');
	loaded = $state(0);
	total = $state(0);
	error = $state<string | null>(null);
	/** set once `upload()` owns the transfer; leaving the page no longer aborts it. */
	claimed = false;
	onProgress: ((loaded: number, total: number) => void) | null = null;

	#uploadId: string | null = null;
	#abort = new AbortController();
	#attempt: Promise<string>;
	readonly #transport: StagedTransport;
	readonly #describe: FailureDescriber;

	constructor(file: File, transport: StagedTransport, describe: FailureDescriber) {
		this.file = file;
		this.total = file.size;
		this.#transport = transport;
		this.#describe = describe;
		this.#attempt = this.#run();
	}

	get uploadId(): string | null {
		return this.#uploadId;
	}

	get progressPercent(): number {
		return this.total === 0 ? 0 : Math.round((this.loaded / this.total) * 100);
	}

	/** resolves with the upload id once every part is acknowledged; rejects with the attempt's failure. */
	whenTransferred(): Promise<string> {
		return this.#attempt;
	}

	retry(): void {
		if (this.status !== 'failed') return;
		this.#abort = new AbortController();
		this.error = null;
		this.#attempt = this.#run();
	}

	abort(): void {
		this.#abort.abort();
	}

	/** the attempt promise itself, with a handler attached so a failure nobody awaits yet is not "unhandled". */
	#run(): Promise<string> {
		const attempt = this.#drive();
		attempt.catch(() => undefined);
		return attempt;
	}

	async #drive(): Promise<string> {
		this.status = 'opening';
		try {
			const session =
				this.#uploadId === null
					? await this.#transport.start(this.file)
					: await this.#transport.resume(this.#uploadId);
			this.#uploadId = session.upload_id;
			this.status = 'transferring';
			await this.#transport.parts({
				file: this.file,
				session,
				signal: this.#abort.signal,
				onProgress: (loaded, total) => {
					this.loaded = loaded;
					this.total = total;
					this.onProgress?.(loaded, total);
				}
			});
			this.status = 'transferred';
			return session.upload_id;
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.status = 'failed';
			this.error = this.#describe(failure, this.progressPercent);
			throw failure;
		}
	}
}
