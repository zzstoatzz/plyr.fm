import type { Track } from './api.ts';
import { createLatestWriter } from './latest-write.ts';
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
  let writer = createLatestWriter();
  function emit() { for (const listener of listeners) listener(); }
  function reset() { session = getAuth().rpc; entries.clear(); writer = createLatestWriter(); emit(); }
  // The unclamped count, so taking back a change the appview never counted can't drift.
  const raw = new WeakMap<LikeSnapshot, number>();
  function show(state: LikeSnapshot, liked: boolean) {
    if (state.liked === liked) return;
    const count = (raw.get(state) ?? state.count) + (liked ? 1 : -1);
    raw.set(state, count);
    state.count = Math.max(0, count);
    state.liked = liked;
  }
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
  /** Shows the change at once; the write follows, and a failed write puts back what was last saved. */
  async function toggle(track: Track) {
    const account = getAuth();
    let state = entry(track);
    if (!account.rpc || state.loading) return;
    if (!state.known) { await load(track); state = entry(track); if (!state.known) return; }
    const uri = track.record.uri;
    const current = () => getAuth().rpc === account.rpc && entries.get(uri) === state;
    if (!current()) return;
    const from = state.liked;
    show(state, !from);
    state.busy = true;
    state.error = '';
    emit();
    const outcome = await writer.want(uri, from, state.liked, liked => {
      const pds = createPds(account);
      return liked ? pds.like(track, { waitForIndex: false }) : pds.unlike(track, { waitForIndex: false });
    });
    if (!outcome || !current()) return;
    show(state, outcome.value);
    state.busy = false;
    if (outcome.failed) state.error = outcome.error instanceof Error ? outcome.error.message : 'could not update this like.';
    emit();
  }
  return { snapshot: (track: Track) => ({ ...entry(track) }), load, toggle, reset,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
