import type { Did } from '../auth-state.ts';
import type { MediaFile, NewTrack } from '../pds.ts';
import { isCreateRkey, type CreateOperation } from './create-operation.ts';
import { canonicalAudioType } from './upload-queue-model.ts';
import { readRule } from '../access/policy.ts';

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
function readFeatures(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw new Error('could not read a queued upload.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.did !== 'string' || !DID.test(item.did) || !optionalText(item.handle) || !optionalText(item.displayName)) throw new Error('could not read a queued upload.');
    return { did: item.did as string, ...(item.handle ? { handle: item.handle as string } : {}), ...(item.displayName ? { displayName: item.displayName as string } : {}) };
  });
}
// a queued upload that loses its ways in would publish open, so an unreadable rule fails the whole draft
function readWaysIn(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('could not read a queued upload.');
  return value.map(item => { const rule = readRule(item); if (!rule) throw new Error('could not read a queued upload.'); return rule; });
}

export type QueuedUploadDraft = Omit<NewTrack, 'file' | 'artwork' | 'duration'> & {
  id: string;
  owner: Did;
  audio: Pick<MediaFile, 'name' | 'type' | 'size'>;
  coverName?: string;
  reservedRkey?: string;
};

export interface QueuedUploadDrafts {
  load(owner: Did): Promise<QueuedUploadDraft[]>;
  put(draft: QueuedUploadDraft): Promise<void>;
  has(draft: QueuedUploadKey): Promise<boolean>;
  take(draft: QueuedUploadKey): Promise<boolean>;
  withLock<T>(draft: QueuedUploadKey, task: () => Promise<T>): Promise<T>;
}

export type QueuedUploadKey = Pick<QueuedUploadDraft, 'owner' | 'id'>;

export function queuedUploadKey(draft: QueuedUploadKey) {
  return `${draft.owner}/${draft.id}`;
}

export function draftInRecovery(draft: QueuedUploadKey, ...records: readonly CreateOperation[][]) {
  return records.some(group => group.some(record => record.owner === draft.owner && record.draftId === draft.id));
}

export function queuedUploadDraft(input: NewTrack, owner: Did, id: string, reservedRkey?: string): QueuedUploadDraft {
  const { file, artwork, duration: _duration, ...fields } = input;
  return { ...fields, owner, id, audio: { name: file.name, type: file.type, size: file.size },
    ...(artwork ? { coverName: artwork.name } : {}), ...(reservedRkey ? { reservedRkey } : {}) };
}

export function readQueuedUploadDraft(value: unknown, owner: Did, key: unknown): QueuedUploadDraft {
  if (!value || typeof value !== 'object') throw new Error('could not read a queued upload.');
  const { id, title, artist, album, description, tags, autoTag, audio, coverName, reservedRkey, explicit } = value as Record<string, unknown>;
  if (typeof id !== 'string' || key !== queuedUploadKey({ owner, id }) || !('owner' in value) || value.owner !== owner ||
    typeof title !== 'string' || typeof artist !== 'string' ||
    (album !== undefined && typeof album !== 'string') || (description !== undefined && typeof description !== 'string') ||
    (tags !== undefined && (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string'))) ||
    (autoTag !== undefined && typeof autoTag !== 'boolean') || (explicit !== undefined && typeof explicit !== 'boolean') || (coverName !== undefined && typeof coverName !== 'string') ||
    (reservedRkey !== undefined && !isCreateRkey(reservedRkey)) ||
    !audio || typeof audio !== 'object' || !('name' in audio) || typeof audio.name !== 'string' ||
    !('type' in audio) || typeof audio.type !== 'string' || !('size' in audio) || typeof audio.size !== 'number') {
    throw new Error('could not read a queued upload.');
  }
  const file = { name: audio.name, type: audio.type, size: audio.size };
  canonicalAudioType(file);
  const features = readFeatures((value as Record<string, unknown>).features);
  const waysIn = readWaysIn((value as Record<string, unknown>).waysIn);
  return { owner, id, title, artist, album, description, tags, autoTag, audio: file, coverName, ...(reservedRkey ? { reservedRkey } : {}),
    ...(features?.length ? { features } : {}), ...(explicit ? { explicit: true } : {}), ...(waysIn?.length ? { waysIn } : {}) };
}

export function reattachQueuedUpload(draft: QueuedUploadDraft, file: MediaFile, artwork?: MediaFile): NewTrack {
  if (file.name !== draft.audio.name || file.size !== draft.audio.size || canonicalAudioType(file) !== canonicalAudioType(draft.audio)) {
    throw new Error('choose the original audio file.');
  }
  if (draft.coverName && !artwork) throw new Error('choose the cover again.');
  const { title, artist, album, description, tags, autoTag, features, explicit, waysIn } = draft;
  return { title, artist, album, description, tags, autoTag, file, artwork, features, explicit, waysIn };
}
