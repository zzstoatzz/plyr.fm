import { useMemo, useSyncExternalStore } from 'react';
import type { Track } from '@plyr/next-core/api';
import { createTrackLikes } from '@plyr/next-core/track-likes';
import { api } from './api-client';
import { getAuth, subscribeAuth } from './auth-state';
import { createPds } from './pds';

/** The one like state on iOS, shared with web through core: every heart, count and likers list reads it, and a like writes it. */
export const likes = createTrackLikes({ getAuth, createPds,
  fetchLikers: (track, cursor) => api.trackLikes(track.id, cursor),
  fetchViewer: async did => { const artist = await api.artist(did); return { handle: artist.handle, display_name: artist.display_name, avatar_url: artist.avatar_url }; } });

let version = 0;
const listeners = new Set<() => void>();
likes.subscribe(() => { version++; for (const listener of listeners) listener(); });
let session = getAuth().rpc;
subscribeAuth(() => { if (session !== getAuth().rpc) { session = getAuth().rpc; likes.reset(); } });
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const read = () => version;

/** Whether you like the track and its count, as every surface shows them. */
export function useTrackLike(track: Track) {
  const seen = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => likes.snapshot(track), [seen, track]);
}

/** Who liked the track, your own like included the moment you make it. */
export function useLikers(track: Track) {
  const seen = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => likes.likers(track), [seen, track]);
}
