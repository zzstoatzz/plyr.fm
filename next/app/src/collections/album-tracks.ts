import { api, trackIdFromUri, type Track } from '../api';
import type { CollectionRevision } from './collection-order';

export async function resolveAlbumTracks(revision: CollectionRevision, known: Track[], signal: AbortSignal) {
  const tracks = new Map(known.map(track => [track.record.uri, track]));
  const missing = [...new Set(revision.value.items.map(item => item.subject.uri))].filter(uri => !tracks.has(uri));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const result = await api.resolveTracks(missing.slice(offset, offset + 100).map(trackIdFromUri), signal);
    for (const track of result.data) tracks.set(track.record.uri, track);
  }
  return [...tracks.values()];
}
