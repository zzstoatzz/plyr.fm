import type { Auth } from '../auth-state';
import * as config from '../auth-config.ts';
import type { UploadOperation } from '../../../core/src/publishing/upload-model';
import { uploadTransport } from '../../../core/src/publishing/upload-transport.ts';

export { UploadRequestError } from '../../../core/src/publishing/upload-transport.ts';

export function createUploadTransport(auth: Pick<Auth, 'did' | 'agent' | 'uploadStorage'>, operation: UploadOperation,
  assertCurrent: () => void, signal: AbortSignal, fetcher?: typeof fetch) {
  return uploadTransport(config, auth, operation, assertCurrent, signal, fetcher);
}
