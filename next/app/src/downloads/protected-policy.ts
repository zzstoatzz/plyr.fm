import type { Track } from '../api.ts';

export function protectedDownloadPolicy(record: Record<string, unknown>): 'open' | 'ask' {
  if (Object.hasOwn(record, 'supportGate') || (record.visibility !== undefined && record.visibility !== 'public' && record.visibility !== 'unlisted')
    || (record.downloadPolicy !== 'open' && record.downloadPolicy !== 'ask')) throw new Error('downloads are unavailable for this protected track.');
  return record.downloadPolicy;
}

export function requireProtectedReference(track: Track, uri: string): void {
  const parts = uri.split('/');
  if (parts.length !== 9 || parts[0] !== 'at:' || parts[1] !== '' || parts[2] !== track.artist.did || parts[3] !== 'space'
    || !parts[4] || !parts[5] || parts[6] !== track.artist.did || parts[7] !== track.record.collection || !parts[8]) throw new Error('this protected track changed. try again.');
}
