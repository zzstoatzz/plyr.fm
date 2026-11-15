import type { Track } from './api.ts';

export function isPrivateTrack(track: Track): boolean {
  return track.access.visibility === 'private' || track.record.uri.includes('/space/');
}

export function ownerTrackKey(id: string): string | undefined {
  const key = /^private_([a-zA-Z0-9._~:-]{1,512})$/.exec(id)?.[1];
  return key === '.' || key === '..' ? undefined : key;
}
