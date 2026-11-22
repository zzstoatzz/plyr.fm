import type { Track } from './api.ts';

export function canToggleTrack(current: { record: Pick<Track['record'], 'uri' | 'cid'> } | null | undefined, target: { record: Pick<Track['record'], 'uri' | 'cid'> }, inJam = false): boolean {
  // The shared queue pins the revision until someone changes the room's selection.
  return !!current && current.record.uri === target.record.uri && (inJam || current.record.cid === target.record.cid);
}
