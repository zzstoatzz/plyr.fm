import type { Track } from '../../../core/src/api';
import { isPrivateTrack } from '../../../core/src/track-access';
import { describeRule, implicitRule, isOpen, trackSpace } from './policy';

/** A few words on who can listen, read from the track alone (no fetch), for list rows. */
export function accessLabel(track: Track): string {
  const space = trackSpace(track);
  if (isPrivateTrack(track) && !space) return 'only you';
  if (isOpen(track)) return 'open';
  const rule = space ? implicitRule(space) : undefined;
  return rule ? `open to ${describeRule(rule)}` : 'closed';
}
