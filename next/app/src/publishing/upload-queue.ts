import { useSyncExternalStore } from 'react';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { trackIdFromUri } from '@plyr/next-core/api';
import { applyGenreTags } from '@plyr/next-core/publishing/genre-tags';
import { createUploadQueue } from '@plyr/next-core/publishing/upload-queue';
import { jobLine } from '@plyr/next-core/publishing/upload-queue-model';
import { getAuth } from '../auth-state';
import { measureAudioDuration } from '../media-picker';
import { createPds } from '../pds';
import { toast } from '../toast';
import { openUploadReader } from './upload-reader';
import { sendParts } from './part-sender';
import { queuedDrafts, uploadStorage } from './upload-storage';
import { createUploadTransport } from './upload-transport';

export const uploadQueue = createUploadQueue({
  getAuth, createPds, measureAudioDuration, openUploadReader, sendParts, uploadStorage, queuedDrafts, createUploadTransport, randomUUID,
  sha256: bytes => digest(CryptoDigestAlgorithm.SHA256, bytes),
  applyGenreTags: (session, uri) => applyGenreTags(() => createPds(session()), uri),
  onJob(job) {
    const key = `upload:${job.id}`;
    if (job.phase === 'done') toast.add(jobLine(job), 'success', 6000, job.uri ? { label: 'view track', href: `/track/${trackIdFromUri(job.uri)}` } : undefined, key);
    else if (job.phase === 'awaiting-publication') toast.add(jobLine(job), 'info', 10000, { label: 'open upload', href: '/upload' }, key);
    else if (job.phase === 'failed') toast.add(jobLine(job), 'error', 10000, { label: 'open upload', href: '/upload' }, key);
    else if (job.phase !== 'waiting') toast.add(jobLine(job), 'info', 0, undefined, key);
  },
  onDismiss(job) { toast.dismissKey(`upload:${job.id}`); }
});

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.snapshot, uploadQueue.snapshot);
}
