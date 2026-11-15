import type { Did } from '../auth-state.ts';
import { albumName } from '../collections/album-membership.ts';
import { queuedUploadKey, readQueuedUploadDraft, type QueuedUploadDraft } from './queued-upload-draft.ts';

export type AlbumUploadSlot = QueuedUploadDraft & { reservedRkey: string };
export type AlbumUploadPlan = {
  id: string;
  owner: Did;
  name: string;
  coverName?: string;
  slots: AlbumUploadSlot[];
};

export function readAlbumUploadPlan(value: unknown, owner: Did): AlbumUploadPlan {
  const invalid = () => new Error('could not read the saved album upload.');
  if (!value || typeof value !== 'object' || !('owner' in value) || value.owner !== owner
    || !('id' in value) || typeof value.id !== 'string' || !value.id
    || !('name' in value) || typeof value.name !== 'string'
    || !('slots' in value) || !Array.isArray(value.slots) || !value.slots.length || value.slots.length > 500) throw invalid();
  const name = albumName(value.name);
  const coverName = 'coverName' in value ? value.coverName : undefined;
  if (coverName !== undefined && typeof coverName !== 'string') throw invalid();
  const slots = value.slots.map((slot: unknown) => {
    if (!slot || typeof slot !== 'object' || !('id' in slot) || typeof slot.id !== 'string' || !slot.id) throw invalid();
    const draft = readQueuedUploadDraft(slot, owner, queuedUploadKey({ owner, id: slot.id }));
    if (!draft.reservedRkey || draft.album !== name || draft.coverName) throw invalid();
    return { ...draft, reservedRkey: draft.reservedRkey };
  });
  if (new Set(slots.map(slot => slot.id)).size !== slots.length
    || new Set(slots.map(slot => slot.reservedRkey)).size !== slots.length) throw invalid();
  return { id: value.id, owner, name, coverName, slots };
}
