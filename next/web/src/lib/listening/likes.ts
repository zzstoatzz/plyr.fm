import { createTrackLikes } from '@plyr/next-core/track-likes';
import { api } from '$lib/api';
import { auth } from '$lib/auth';

export const likes = createTrackLikes({ getAuth: auth.getAuth, createPds: account => ({
  myLikes: async () => (await import('$lib/pds')).createPds(account).myLikes(),
  like: async (track, options) => (await import('$lib/pds')).createPds(account).like(track, options),
  unlike: async (track, options) => (await import('$lib/pds')).createPds(account).unlike(track, options)
}),
  fetchLikers: (track, cursor) => api.trackLikes(track.id, cursor),
  fetchViewer: async did => { const artist = await api.artist(did); return { handle: artist.handle, display_name: artist.display_name, avatar_url: artist.avatar_url }; } });
let session = auth.getAuth().rpc;
auth.subscribe(() => {
  if (session !== auth.getAuth().rpc) { session = auth.getAuth().rpc; likes.reset(); }
});
