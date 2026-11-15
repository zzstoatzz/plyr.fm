import type { Auth } from '../auth-state';
import * as config from '../auth-config.ts';
import type { UploadOperation } from '@plyr/next-core/publishing/upload-model';
import { uploadTransport } from '@plyr/next-core/publishing/upload-transport';

export { UploadRequestError } from '@plyr/next-core/publishing/upload-transport';

export function createUploadTransport(auth: Pick<Auth, 'did' | 'agent' | 'uploadStorage'>, operation: UploadOperation,
  assertCurrent: () => void, signal: AbortSignal, fetcher?: typeof fetch) {
  return uploadTransport(config, auth, operation, assertCurrent, signal, fetcher);
}
