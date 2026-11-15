import type { Track } from './api.ts';

export function isPrivateTrack(track: Track): boolean {
  return track.access.visibility === 'private' || track.record.uri.includes('/space/');
}

export function ownerTrackAddress(id: string): { owner: string; rkey: string } | undefined {
  const match = /^(did:(?:plc|web):[^|/?#]+)\|([a-zA-Z0-9._~:-]{1,512})$/.exec(id);
  if (!match || match[2] === '.' || match[2] === '..') return;
  return { owner: match[1], rkey: match[2] };
}
