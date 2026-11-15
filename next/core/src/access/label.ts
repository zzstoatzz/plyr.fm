import type { Track } from '../api.ts';
import { isPrivateTrack } from '../track-access.ts';
import { describeRule, implicitRule, isOpen, trackSpace } from './policy.ts';

/** A few words on who can listen, read from the track alone (no fetch), for list rows. */
export function accessLabel(track: Track, audioSpaceType: string): string {
  const space = trackSpace(track, audioSpaceType);
  if (isPrivateTrack(track) && !space) return 'only you';
  if (isOpen(track)) return 'open';
  const rule = space ? implicitRule(space) : undefined;
  return rule ? `open to ${describeRule(rule)}` : 'closed';
}
