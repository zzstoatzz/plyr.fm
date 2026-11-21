import { useSyncExternalStore } from 'react';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { trackIdFromUri } from '@plyr/next-core/api';
import { applyGenreTags } from '@plyr/next-core/publishing/genre-tags';
import { addBuyLink } from '@plyr/next-core/selling';
import { accountSettings } from '../preference-sync';
import { createUploadQueue } from '@plyr/next-core/publishing/upload-queue';
import { jobLine } from '@plyr/next-core/publishing/upload-queue-model';
import { islandJob, uploadIsland } from '@plyr/next-core/publishing/upload-island';
import { getAuth } from '../auth-state';
import { measureAudioDuration } from '../media-picker';
import { createPds } from '../pds';
import { toast } from '../toast';
import { hideUploadIsland, showUploadIsland } from './upload-island-store';
import { openUploadReader } from './upload-reader';
import { sendParts } from './part-sender';
import { queuedDrafts, uploadStorage } from './upload-storage';
import { createUploadTransport } from './upload-transport';

export const uploadQueue = createUploadQueue({
  getAuth, createPds, measureAudioDuration, openUploadReader, sendParts, uploadStorage, queuedDrafts, createUploadTransport, randomUUID,
  sha256: bytes => digest(CryptoDigestAlgorithm.SHA256, bytes),
  applyGenreTags: (session, uri) => applyGenreTags(() => createPds(session()), uri),
  saveBuyLink: (session, subject, link) => {
    const account = session();
    if (!account.agent || !account.accountSync) throw new Error('sign in again to save buy links');
    return addBuyLink(accountSettings(account.agent, new AbortController().signal), subject, link);
  },
  onJob(job) {
    const key = `upload:${job.id}`;
    // Steps show in the island; the finish also leaves a toast with somewhere to go.
    // onJob runs before the queue republishes, so the snapshot may hold this job's previous step; `job` is current.
    const followed = islandJob(uploadQueue.snapshot(), job);
    showUploadIsland(`upload:${followed.id}`, uploadIsland(followed.id === job.id ? job : followed));
    if (job.phase === 'done') toast.add(jobLine(job), 'success', 6000, job.uri ? { label: 'view track', href: `/track/${trackIdFromUri(job.uri)}` } : undefined, key);
    else if (job.phase === 'awaiting-publication') toast.add(jobLine(job), 'info', 10000, { label: 'open upload', href: '/upload' }, key);
    else if (job.phase === 'failed') toast.add(jobLine(job), 'error', 10000, { label: 'open upload', href: '/upload' }, key);
    else toast.dismissKey(key);
  },
  onDismiss(job) { toast.dismissKey(`upload:${job.id}`); hideUploadIsland(`upload:${job.id}`); }
});

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.snapshot, uploadQueue.snapshot);
}
