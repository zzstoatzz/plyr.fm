import type { Track } from './api.ts';

export function canToggleTrack(current: Track | null | undefined, target: Track, inJam = false): boolean {
  // The shared queue pins the revision until someone changes the room's selection.
  return !!current && current.record.uri === target.record.uri && (inJam || current.record.cid === target.record.cid);
}
