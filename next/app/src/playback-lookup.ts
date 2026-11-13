import { api, type Playback, type Track } from './api';
import { isPrivateTrack } from './publishing/private-track';

const fresh = 60_000;
const warmed = new Map<string, { at: number; lookup: Promise<Playback> }>();

/** The playback lookup for a track, reusing one `warm` started within the last minute. */
export function playbackFor(id: string): Promise<Playback> {
  const hit = warmed.get(id);
  warmed.delete(id);
  return hit && Date.now() - hit.at < fresh ? hit.lookup.catch(() => api.playback(id)) : api.playback(id);
}

/** Starts the lookup for the track likely to play next, so skipping to it waits only on audio. */
export function warm(track: Track | undefined) {
  if (!track || isPrivateTrack(track) || warmed.has(track.id)) return;
  const lookup = api.playback(track.id);
  lookup.catch(() => {});
  warmed.set(track.id, { at: Date.now(), lookup });
  for (const id of warmed.keys()) if (warmed.size > 4) warmed.delete(id);
}
