import type { Did } from '../auth-state.ts';
import type { MediaFile, NewTrack } from '../pds.ts';
import { canonicalAudioType } from './upload-queue-model.ts';

export type QueuedUploadDraft = Omit<NewTrack, 'file' | 'artwork' | 'duration'> & {
  id: string;
  owner: Did;
  audio: Pick<MediaFile, 'name' | 'type' | 'size'>;
  coverName?: string;
};

export interface QueuedUploadDrafts {
  load(owner: Did): Promise<QueuedUploadDraft[]>;
  put(draft: QueuedUploadDraft): Promise<void>;
  take(draft: QueuedUploadDraft): Promise<boolean>;
}

export function queuedUploadKey(draft: Pick<QueuedUploadDraft, 'owner' | 'id'>) {
  return `${draft.owner}/${draft.id}`;
}

export function queuedUploadDraft(input: NewTrack, owner: Did, id: string): QueuedUploadDraft {
  const { file, artwork, duration: _duration, ...fields } = input;
  return { ...fields, owner, id, audio: { name: file.name, type: file.type, size: file.size },
    ...(artwork ? { coverName: artwork.name } : {}) };
}

export function readQueuedUploadDraft(value: unknown, owner: Did, key: unknown): QueuedUploadDraft {
  if (!value || typeof value !== 'object') throw new Error('could not read a queued upload.');
  const { id, title, artist, album, description, tags, autoTag, audio, coverName } = value as Record<string, unknown>;
  if (typeof id !== 'string' || key !== queuedUploadKey({ owner, id }) || !('owner' in value) || value.owner !== owner ||
    typeof title !== 'string' || typeof artist !== 'string' ||
    (album !== undefined && typeof album !== 'string') || (description !== undefined && typeof description !== 'string') ||
    (tags !== undefined && (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string'))) ||
    (autoTag !== undefined && typeof autoTag !== 'boolean') || (coverName !== undefined && typeof coverName !== 'string') ||
    !audio || typeof audio !== 'object' || !('name' in audio) || typeof audio.name !== 'string' ||
    !('type' in audio) || typeof audio.type !== 'string' || !('size' in audio) || typeof audio.size !== 'number') {
    throw new Error('could not read a queued upload.');
  }
  const file = { name: audio.name, type: audio.type, size: audio.size };
  canonicalAudioType(file);
  return { owner, id, title, artist, album, description, tags, autoTag, audio: file, coverName };
}

export function reattachQueuedUpload(draft: QueuedUploadDraft, file: MediaFile, artwork?: MediaFile): NewTrack {
  if (file.name !== draft.audio.name || file.size !== draft.audio.size || canonicalAudioType(file) !== canonicalAudioType(draft.audio)) {
    throw new Error('choose the original audio file.');
  }
  if (draft.coverName && !artwork) throw new Error('choose the cover again.');
  const { title, artist, album, description, tags, autoTag } = draft;
  return { title, artist, album, description, tags, autoTag, file, artwork };
}
