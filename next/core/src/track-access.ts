import type { Track } from './api.ts';

export function isPrivateTrack(track: Track): boolean {
  return track.access.visibility === 'private' || track.record.uri.includes('/space/');
}
