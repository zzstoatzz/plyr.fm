import { createUploadQueue } from '$core/publishing/upload-queue';
import { uploadTransport } from '$core/publishing/upload-transport';
import { transferParts, type UploadOperation } from '$core/publishing/upload-model';
import { applyGenreTags } from '$core/publishing/genre-tags';
import { auth } from './auth';
import { authConfig } from './auth-config';
import { createPds } from './pds';
import { fileDuration } from './media/file-duration';
import { uploadStorage } from './storage/upload-storage';
import { openUploadReader } from './storage/upload-reader';

export function createUploadTransport(account: Pick<ReturnType<typeof auth.getAuth>, 'did' | 'agent' | 'uploadStorage'>,
  operation: UploadOperation, assertCurrent: () => void, signal: AbortSignal) {
  return uploadTransport(authConfig, account, operation, assertCurrent, signal);
}

export const uploadQueue = createUploadQueue({
  getAuth: auth.getAuth, createPds, uploadStorage, createUploadTransport, openUploadReader,
  sendParts: transferParts,
  measureAudioDuration: file => file instanceof Blob ? fileDuration(file) : Promise.resolve(undefined),
  randomUUID: () => crypto.randomUUID(),
  sha256: bytes => crypto.subtle.digest('SHA-256', bytes),
  applyGenreTags: (session, uri) => applyGenreTags(() => createPds(session()), uri),
});
