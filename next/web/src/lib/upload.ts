import { createUploadQueue } from '@plyr/next-core/publishing/upload-queue';
import { uploadTransport } from '@plyr/next-core/publishing/upload-transport';
import { transferParts, type UploadOperation } from '@plyr/next-core/publishing/upload-model';
import { applyGenreTags } from '@plyr/next-core/publishing/genre-tags';
import { preferenceTransport } from '@plyr/next-core/preference-transport';
import { addBuyLink } from '@plyr/next-core/selling';
import { auth } from './auth';
import { uploadActivity } from './upload-activity.svelte';
import { authConfig } from './auth-config';
import { createPds } from './pds';
import { fileDuration } from './media/file-duration';
import { queuedDrafts, uploadStorage } from './storage/upload-storage';
import { openUploadReader } from './storage/upload-reader';

export function createUploadTransport(account: Pick<ReturnType<typeof auth.getAuth>, 'did' | 'agent' | 'uploadStorage'>,
  operation: UploadOperation, assertCurrent: () => void, signal: AbortSignal) {
  return uploadTransport(authConfig, account, operation, assertCurrent, signal);
}

export const uploadQueue = createUploadQueue({
  getAuth: auth.getAuth, createPds, uploadStorage, queuedDrafts, createUploadTransport, openUploadReader,
  sendParts: transferParts,
  measureAudioDuration: file => file instanceof Blob ? fileDuration(file) : Promise.resolve(undefined),
  randomUUID: () => crypto.randomUUID(),
  sha256: bytes => crypto.subtle.digest('SHA-256', bytes),
  applyGenreTags: (session, uri) => applyGenreTags(() => createPds(session()), uri),
  saveBuyLink: (session, subject, link) => {
    const account = session();
    if (!account.agent || !account.accountSync) throw new Error('sign in again to save buy links');
    return addBuyLink(preferenceTransport(account.agent, authConfig, new AbortController().signal), subject, link);
  },
});

uploadQueue.subscribe(() => { uploadActivity.jobs = uploadQueue.snapshot(); });
