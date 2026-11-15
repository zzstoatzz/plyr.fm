import type { Track } from '../api';
import type { CollectionItem, CollectionRevision } from './collection-order';

export type AlbumEntry = number | Track;

export function albumName(value: string) {
  const name = value.trim();
  if (!name || name.length > 64 || new TextEncoder().encode(name).length > 256) throw new Error('choose an album name up to 64 characters.');
  return name;
}

export function albumMembership(revision: CollectionRevision, entries: AlbumEntry[], additions: Map<Track, CollectionItem>) {
  if (entries.length > 500) throw new Error('albums hold at most 500 tracks.');
  const kept = entries.filter((entry): entry is number => typeof entry === 'number');
  if (new Set(kept).size !== kept.length || kept.some(index => !Number.isInteger(index) || index < 0 || index >= revision.value.items.length)) throw new Error('invalid album entry. reload the album.');
  return entries.map(entry => {
    if (typeof entry === 'number') return revision.value.items[entry];
    const item = additions.get(entry);
    if (!item) throw new Error('could not verify the selected track.');
    return item;
  });
}
