import type { Track } from '../api';
import { NSID } from '../auth-config.ts';
import { isPrivateTrack } from './private-track.ts';

export function publicTrackReference(track: Track): { uri: string; cid: string } {
  if (isPrivateTrack(track)) throw new Error('private tracks cannot be included in public records.');
  if (!track.record.cid) throw new Error('track has no verified cid');
  return { uri: track.record.uri, cid: track.record.cid };
}

export function assertPublicCollection(value: unknown): void {
  if (!value || typeof value !== 'object' || !('$type' in value) || value.$type !== NSID.list
    || !('items' in value) || !Array.isArray(value.items)) return;
  for (const item of value.items) {
    const subject: unknown = item && typeof item === 'object' && 'subject' in item ? item.subject : undefined;
    if (subject && typeof subject === 'object' && 'uri' in subject && typeof subject.uri === 'string' && subject.uri.includes('/space/')) {
      throw new Error('private tracks cannot be included in public records.');
    }
  }
}
