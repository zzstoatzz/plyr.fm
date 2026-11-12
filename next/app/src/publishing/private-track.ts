import * as queue from '../queue-state.ts';
import type { Track } from '../api';
import { NSID, PRIVATE_SPACE_TYPE } from '../auth-config.ts';

export { PRIVATE_SPACE_TYPE } from '../auth-config.ts';
export function privateSpace(owner: string) { return `at://${owner}/space/${PRIVATE_SPACE_TYPE}/self`; }

export function isPrivateTrack(track: Track): boolean {
  return track.access.visibility === 'private' || track.record.uri.includes('/space/');
}

export function privateTrack(owner: string, rkey: string, cid: string, value: unknown): Track {
  if (!/^did:(plc|web):[^/?#]+$/.test(owner) || !/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey) || rkey === '.' || rkey === '..' || !cid || !value || typeof value !== 'object'
    || !('$type' in value) || value.$type !== NSID.track || !('title' in value) || typeof value.title !== 'string'
    || !('artist' in value) || typeof value.artist !== 'string' || !('createdAt' in value) || typeof value.createdAt !== 'string') {
    throw new Error('could not read your private track.');
  }
  const uri = `${privateSpace(owner)}/${owner}/${NSID.track}/${rkey}`;
  return {
    object: 'track', id: `private_${rkey}`,
    record: { uri, cid, revision: cid, collection: NSID.track, rkey },
    metadata: { title: value.title, artist_name: value.artist, created_at: value.createdAt,
      album: 'album' in value && typeof value.album === 'string' ? value.album : null,
      description: 'description' in value && typeof value.description === 'string' ? value.description : null,
      duration_seconds: 'duration' in value && typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 ? value.duration : null },
    artist: { did: owner, profile: { handle: '', display_name: value.artist, avatar_url: null } },
    media: {}, access: { visibility: 'private' }, metrics: { play_count: 0, like_count: 0 },
  };
}

export function editPrivateQueue(tracks: Track[], index: number, edit: { action: 'remove'; at: number } | { action: 'move'; from: number; to: number } | { action: 'clear' | 'shuffle' }): Track[] {
  const state = { entries: tracks.map((track, at) => ({ key: String(at), track })), index };
  const next = edit.action === 'remove' ? queue.removeEntry(state, edit.at)
    : edit.action === 'move' ? queue.moveEntry(state, edit.from, edit.to)
      : edit.action === 'clear' ? queue.clearPicks(state) : queue.shufflePicks(state);
  return next.entries.map(entry => entry.track);
}

export function withoutPrivateTrack(tracks: Track[], index: number, uri: string) {
  const currentRemoved = tracks[index]?.record.uri === uri;
  const before = tracks.slice(0, index).filter(track => track.record.uri === uri).length;
  const queue = tracks.filter(track => track.record.uri !== uri);
  return { queue, index: queue.length ? Math.min(Math.max(0, index - before), queue.length - 1) : -1, currentRemoved };
}
