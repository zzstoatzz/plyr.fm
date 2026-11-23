import { createMMKV } from 'react-native-mmkv';
import { File as LocalFile } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { TID } from '@atproto/common-web';
import { albumName } from '@plyr/next-core/collections/album-membership';
import { readAlbumUploadPlan, type AlbumUploadPlan, type AlbumUploadSlot } from '@plyr/next-core/publishing/album-upload-plan';
import { draftInRecovery, queuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
import { uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
import type { FeaturedArtist, MediaFile, NewTrack } from '@plyr/next-core/pds';
import type { Auth } from '../auth-state';
import { createPds } from '../pds';
import { uploadQueue } from './upload-queue';
import { queuedDrafts, uploadStorage } from './upload-storage';
import { NSID } from '../config';

/** One album at a time per account: the files upload as tracks, then the album is made from them in order. */
const plans = createMMKV({ id: 'plyr-next-album-uploads' });
const covers = createMMKV({ id: 'plyr-next-album-upload-covers' });
const busy = new Set<string>();
const finished = new Map<string, string>();
const listeners = new Set<() => void>();

export type AlbumTrack = { key: string; file: MediaFile; title: string; explicit: boolean; features: FeaturedArtist[] };
export type AlbumSettings = { tags?: string[]; autoTag: boolean; inFeeds: boolean };
export type SlotState = 'done' | 'working' | 'waiting' | 'stopped';
export type AlbumProgress = { plan: AlbumUploadPlan; slots: { slot: AlbumUploadSlot; state: SlotState; detail?: string }[] };

const trackUri = (slot: AlbumUploadSlot) => `at://${slot.owner}/${NSID.track}/${slot.reservedRkey}`;
export const albumUri = (plan: AlbumUploadPlan) => `at://${plan.owner}/${NSID.list}/${plan.reservedRkey}`;
const changed = () => { for (const listener of listeners) listener(); };

export function subscribeAlbumUploads(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function savedAlbumUpload(owner: string): AlbumUploadPlan | undefined {
  const value = plans.getString(owner);
  return value === undefined ? undefined : readAlbumUploadPlan(JSON.parse(value), owner as AlbumUploadPlan['owner']);
}

/** The album the last finished upload made, for the screen to link. */
export function finishedAlbum(owner: string) { return finished.get(owner); }

export function albumUploadCover(plan: AlbumUploadPlan): MediaFile | undefined {
  const value = covers.getString(plan.id);
  if (!value) return;
  const { uri, name, type, size } = JSON.parse(value) as { uri: string; name: string; type: string; size: number };
  const file = new LocalFile(uri);
  if (!file.exists) return;
  return { uri, name, type, size, arrayBuffer: () => file.arrayBuffer() };
}

function forget(plan: AlbumUploadPlan) {
  plans.remove(plan.owner);
  covers.remove(plan.id);
  changed();
}

export async function startAlbumUpload(auth: Auth, artist: string, name: string, cover: MediaFile | null, tracks: AlbumTrack[], settings: AlbumSettings) {
  const owner = auth.did;
  if (!owner) throw new Error('sign in first.');
  if (savedAlbumUpload(owner)) throw new Error('finish the album already uploading first.');
  if (!tracks.length || tracks.length > 500) throw new Error('an album holds between 1 and 500 tracks.');
  const title = albumName(name);
  const entries = tracks.map(track => ({
    id: randomUUID(), reservedRkey: TID.nextStr(),
    input: {
      file: track.file, title: track.title.trim(), artist, album: title, tags: settings.tags, autoTag: settings.autoTag,
      ...(track.features.length ? { features: track.features } : {}), ...(track.explicit ? { explicit: true } : {}), ...(settings.inFeeds ? {} : { unlisted: true })
    } satisfies NewTrack
  }));
  const plan: AlbumUploadPlan = {
    owner: owner as AlbumUploadPlan['owner'], id: randomUUID(), reservedRkey: TID.nextStr(), name: title,
    slots: entries.map(({ input, id, reservedRkey }) => ({ ...queuedUploadDraft(input, owner as AlbumUploadPlan['owner'], id, reservedRkey), reservedRkey }))
  };
  // held until every track is queued, so a queue update in between can't read the album as finished
  busy.add(owner);
  try {
    plans.set(owner, JSON.stringify(readAlbumUploadPlan(plan, plan.owner)));
    if (cover?.uri) covers.set(plan.id, JSON.stringify({ uri: cover.uri, name: cover.name, type: cover.type, size: cover.size }));
    for (const { input, id, reservedRkey } of entries) await uploadQueue.add(input, { owner: plan.owner, id, reservedRkey });
  } finally {
    busy.delete(owner);
    changed();
  }
  return plan;
}

/** Where each track stands; reads the PDS for tracks the queue no longer holds. */
export async function albumProgress(auth: Auth): Promise<AlbumProgress | undefined> {
  const plan = auth.did ? savedAlbumUpload(auth.did) : undefined;
  if (!plan) return;
  const organization = createPds(auth).albumOrganization();
  const jobs = uploadQueue.snapshot();
  const slots = await Promise.all(plan.slots.map(async slot => {
    const job = jobs.findLast(item => item.owner === plan.owner && item.draftId === slot.id);
    if (job && (uploadInProgress(job.phase) || job.phase === 'awaiting-publication')) return { slot, state: job.phase === 'waiting' ? 'waiting' as const : 'working' as const, detail: job.phase === 'uploading' && job.progress ? `${Math.round(job.progress * 100)}%` : job.phase };
    if (await organization.readUpload(trackUri(slot))) return { slot, state: 'done' as const };
    return { slot, state: 'stopped' as const, detail: job?.error ? `didn’t finish: ${job.error}` : 'waiting in upload recovery' };
  }));
  return { plan, slots };
}

/** Once no track is still uploading, make the album from the ones that made it; the rest stay in upload recovery. */
export async function finishAlbumUpload(auth: Auth): Promise<string | undefined> {
  const owner = auth.did;
  if (!owner || busy.has(owner)) return;
  busy.add(owner);
  try {
    const progress = await albumProgress(auth);
    if (!progress || progress.slots.some(item => item.state === 'working' || item.state === 'waiting')) return;
    const { plan } = progress;
    const pds = createPds(auth);
    const organization = pds.albumOrganization();
    const existing = await organization.read(albumUri(plan)).catch(() => null);
    if (existing) { finished.set(owner, existing.uri); forget(plan); return existing.uri; }
    const ready: { uri: string; cid: string }[] = [];
    for (const { slot, state } of progress.slots) {
      if (state === 'done') { const reference = await organization.readUpload(trackUri(slot)); if (reference) ready.push(reference); continue; }
      // a track that didn't finish stays in upload recovery to try again on its own
      const [creates, transfers] = await Promise.all([pds.pendingCreates('track'), uploadStorage.load(owner)]);
      if (!await queuedDrafts.has(slot) && !draftInRecovery(slot, creates, transfers)) await queuedDrafts.put(slot).catch(() => undefined);
    }
    if (!ready.length) { forget(plan); return; }
    const result = await organization.createFromUploads(plan.name, ready, albumUploadCover(plan), {
      id: plan.id, reservedRkey: plan.reservedRkey, handedOff: async () => { finished.set(owner, albumUri(plan)); forget(plan); }
    });
    finished.set(owner, result.uri);
    forget(plan);
    if (result.status === 'indexed') {
      const accepted = (await pds.pendingCreates('album')).find(operation => operation.uri === result.uri && operation.cid);
      if (accepted) await pds.dismissCreate(accepted).catch(() => undefined);
    }
    return result.uri;
  } finally {
    busy.delete(owner);
    changed();
  }
}
