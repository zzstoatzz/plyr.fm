import type { Track } from './api.ts';
import type { createPublicPds } from './pds.ts';

type Account = { did: string | null; rpc: unknown };
type Writer = Pick<ReturnType<typeof createPublicPds>, 'myLikes' | 'like' | 'unlike'>;
export type LikeSnapshot = { liked: boolean; count: number; loading: boolean; busy: boolean; known: boolean; error: string };

export function createTrackLikes<Session extends Account>({ getAuth, createPds }: {
  getAuth(): Session;
  createPds(account: NoInfer<Session>): Writer;
}) {
  const entries = new Map<string, LikeSnapshot>();
  const listeners = new Set<() => void>();
  let session = getAuth().rpc;
  function emit() { for (const listener of listeners) listener(); }
  function reset() { session = getAuth().rpc; entries.clear(); emit(); }
  function entry(track: Track) {
    if (session !== getAuth().rpc) reset();
    let found = entries.get(track.record.uri);
    if (!found) {
      found = { liked: false, count: track.metrics.like_count, loading: false, busy: false, known: false, error: '' };
      entries.set(track.record.uri, found);
    }
    return found;
  }
  async function load(track: Track) {
    const account = getAuth();
    const state = entry(track);
    if (!account.rpc || state.known || state.loading) return;
    const current = () => getAuth().rpc === account.rpc && entries.get(track.record.uri) === state;
    state.loading = true;
    state.error = '';
    emit();
    try {
      const likes = await createPds(account).myLikes();
      if (current()) { state.liked = likes.has(track.record.uri); state.known = true; }
    } catch {
      if (current()) state.error = 'could not load your like. try again.';
    } finally { if (current()) { state.loading = false; emit(); } }
  }
  async function toggle(track: Track) {
    const account = getAuth();
    const state = entry(track);
    if (!account.rpc || state.busy || state.loading) return;
    if (!state.known) { await load(track); if (!state.known) return; }
    const current = () => getAuth().rpc === account.rpc && entries.get(track.record.uri) === state;
    if (!current()) return;
    state.busy = true;
    state.error = '';
    emit();
    try {
      const writer = createPds(account);
      if (state.liked) await writer.unlike(track, { waitForIndex: false });
      else await writer.like(track, { waitForIndex: false });
      if (current()) { state.count = Math.max(0, state.count + (state.liked ? -1 : 1)); state.liked = !state.liked; }
    } catch (failure) {
      if (current()) state.error = failure instanceof Error ? failure.message : 'could not update this like.';
    } finally { if (current()) { state.busy = false; emit(); } }
  }
  return { snapshot: (track: Track) => ({ ...entry(track) }), load, toggle, reset,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
