import type { Track } from '../api';
import { isPrivateTrack } from '../publishing/private-track';
import { describeRule, implicitRule, isOpen, trackSpace } from './policy';

/** A few words on who can listen, read from the track alone (no fetch), for list rows. */
export function accessLabel(track: Track): string {
  const space = trackSpace(track);
  if (isPrivateTrack(track) && !space) return 'only you';
  if (isOpen(track)) return 'open';
  const rule = space ? implicitRule(space) : undefined;
  return rule ? `open to ${describeRule(rule)}` : 'closed';
}
