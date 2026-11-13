import { useCallback, useEffect, useState } from 'react';
import type { Track } from '../api';
import { isPrivateTrack } from '../publishing/private-track';
import { listPolicies } from './policy-pds';
import { implicitRule, isOpen, trackSpace, type Policy, type Rule } from './policy';

export type TrackAccess =
  | { state: 'open' }
  | { state: 'owner-only' }
  | { state: 'closed'; space?: string; policies?: Policy[]; fallback?: Rule; error?: string; reload: () => void };

/** whether a track is open, and if closed, the policies that let people in */
export function useTrackAccess(track: Track): TrackAccess {
  const space = trackSpace(track);
  const [read, setRead] = useState<{ space: string; policies?: Policy[]; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!space) return;
    const controller = new AbortController();
    listPolicies(track.artist.did, space, controller.signal)
      .then(policies => setRead({ space, policies }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setRead({ space, error: error instanceof Error ? error.message : 'could not read who can listen.' }); });
    return () => controller.abort();
  }, [space, track.artist.did, attempt]);
  if (isPrivateTrack(track) && !space) return { state: 'owner-only' };
  if (isOpen(track)) return { state: 'open' };
  if (!space) return { state: 'closed', reload };
  const current = read?.space === space ? read : undefined;
  return { state: 'closed', space, policies: current?.policies, error: current?.error, fallback: implicitRule(space), reload };
}
