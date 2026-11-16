import { createTrackLikes } from '@plyr/next-core/track-likes';
import { auth } from '$lib/auth';

export const likes = createTrackLikes({ getAuth: auth.getAuth, createPds: account => ({
  myLikes: async () => (await import('$lib/pds')).createPds(account).myLikes(),
  like: async (track, options) => (await import('$lib/pds')).createPds(account).like(track, options),
  unlike: async (track, options) => (await import('$lib/pds')).createPds(account).unlike(track, options)
}) });
let session = auth.getAuth().rpc;
auth.subscribe(() => {
  if (session !== auth.getAuth().rpc) { session = auth.getAuth().rpc; likes.reset(); }
});
