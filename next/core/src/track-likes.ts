import type { LikeActor, Page, Track, TrackLike } from './api.ts';
import { createLatestWriter } from './latest-write.ts';
import { reportError as report } from './report-error.ts';
import type { createPublicPds } from './pds.ts';

type Account = { did: string | null; handle?: string | null; rpc: unknown };
type Writer = Pick<ReturnType<typeof createPublicPds>, 'myLikes' | 'like' | 'unlike'>;
export type LikeSnapshot = { liked: boolean; count: number; loading: boolean; busy: boolean; known: boolean; error: string };
/** Who liked a track as every surface shows it: the appview's pages with your own like laid over them, so a like or unlike shows at once. */
export type LikersSnapshot = { people: LikeActor[]; loading: boolean; error: boolean; more: boolean; loaded: boolean };
type Likers = { people: LikeActor[]; cursor?: string; loading: boolean; error: boolean; loaded: boolean; at: number; generation: number };

/** A list read this long ago is fetched again when it is next opened. */
const FRESH_FOR = 30_000;
/** How long after your last change a newer appview count may still predate it; after that the appview's count wins. */
const SETTLE_FOR = 15_000;

/**
 * The one like state for a track: whether you like it, its count and who liked it. Every heart, count and
 * likers list reads it, and a like writes it, so no surface can show the like while another still shows the old answer.
 */
export function createTrackLikes<Session extends Account>({ getAuth, createPds, fetchLikers, fetchViewer, now = Date.now }: {
  getAuth(): Session;
  createPds(account: NoInfer<Session>): Writer;
  fetchLikers?(track: Track, cursor?: string): Promise<Page<TrackLike>>;
  /** Your own profile, to show in the likers list before the appview lists your like. */
  fetchViewer?(did: string): Promise<LikeActor['profile']>;
  now?(): number;
}) {
  const entries = new Map<string, LikeSnapshot>();
  const lists = new Map<string, Likers>();
  const listeners = new Set<() => void>();
  let session = getAuth().rpc;
  let writer = createLatestWriter();
  let viewer: { did: string; profile?: LikeActor['profile']; asked: boolean } | undefined;
  function emit() {
    for (const listener of listeners) {
      try { listener(); }
      catch (error) { report(error); }
    }
  }
  function reset() { session = getAuth().rpc; entries.clear(); viewer = undefined; writer = createLatestWriter(); emit(); }
  function sync() { if (session !== getAuth().rpc) reset(); }
  // The unclamped count, so taking back a change the appview never counted can't drift.
  const raw = new WeakMap<LikeSnapshot, number>();
  // the appview count each entry was built from, and when you last changed it here
  const bases = new WeakMap<LikeSnapshot, { count: number; changed: number }>();
  function show(state: LikeSnapshot, liked: boolean) {
    if (state.liked === liked) return;
    const count = (raw.get(state) ?? state.count) + (liked ? 1 : -1);
    raw.set(state, count);
    state.count = Math.max(0, count);
    state.liked = liked;
    const base = bases.get(state);
    if (base) base.changed = now();
  }
  function entry(track: Track) {
    sync();
    let found = entries.get(track.record.uri);
    const fresh = track.metrics.like_count;
    if (!found) {
      found = { liked: false, count: fresh, loading: false, busy: false, known: false, error: '' };
      entries.set(track.record.uri, found);
      bases.set(found, { count: fresh, changed: -Infinity });
    }
    const base = bases.get(found)!;
    // a newer read of the track (someone else liked it, a refresh) moves the count, once your own change has had time to be counted in it
    if (fresh !== base.count && !found.busy && now() - base.changed > SETTLE_FOR) {
      base.count = fresh;
      found.count = Math.max(0, fresh);
      raw.delete(found);
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
  /** You as a liker; `ask` fetches your profile once, which only a write or a load does, never a read during render. */
  function own(account: Session, ask = false): LikeActor | undefined {
    if (!account.did) return undefined;
    if (viewer?.did !== account.did) viewer = { did: account.did, asked: false };
    const mine = viewer;
    if (ask && fetchViewer && !mine.asked) {
      mine.asked = true;
      fetchViewer(account.did).then(profile => { if (viewer === mine && profile) { mine.profile = profile; emit(); } }, () => {});
    }
    return { did: account.did, profile: mine.profile ?? (account.handle ? { handle: account.handle } : null) };
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
    if (state.liked) own(account, true);
    emit();
    const outcome = await writer.want(uri, from, state.liked, liked => {
      const pds = createPds(account);
      return liked ? pds.like(track, { waitForIndex: false }) : pds.unlike(track, { waitForIndex: false });
    });
    if (!outcome || !current()) return;
    show(state, outcome.value);
    state.busy = false;
    // the next look at who liked it reads the appview again; your own like shows from here until then
    const list = lists.get(uri);
    if (list) list.at = 0;
    if (outcome.failed) state.error = outcome.error instanceof Error ? outcome.error.message : 'could not update this like.';
    emit();
    return outcome;
  }
  function likers(track: Track): LikersSnapshot {
    const state = entry(track);
    const list = lists.get(track.record.uri);
    const account = getAuth();
    let people = list?.people ?? [];
    if (account.did && account.rpc && state.known) {
      const others = people.filter(person => person.did !== account.did);
      const listed = people.find(person => person.did === account.did);
      const mine = state.liked ? listed?.profile ? listed : own(account) : undefined;
      people = mine ? [mine, ...others] : others;
    }
    return { people, loading: list?.loading ?? false, error: list?.error ?? false, more: !!list?.cursor, loaded: list?.loaded ?? false };
  }
  /** Reads the first page (again, once it is older than FRESH_FOR), or the next page with `more`. */
  async function loadLikers(track: Track, { more = false }: { more?: boolean } = {}) {
    if (!fetchLikers) return;
    void load(track);
    own(getAuth(), true);
    const uri = track.record.uri;
    let list = lists.get(uri);
    if (!list) { list = { people: [], loading: false, error: false, loaded: false, at: 0, generation: 0 }; lists.set(uri, list); }
    if (list.loading) return;
    if (more ? !list.cursor : list.loaded && now() - list.at < FRESH_FOR) return;
    const ask = ++list.generation;
    const cursor = more ? list.cursor : undefined;
    const target = list;
    list.loading = true;
    list.error = false;
    emit();
    try {
      const page = await fetchLikers(track, cursor);
      if (target.generation !== ask || lists.get(uri) !== target) return;
      const merged = more ? [...target.people, ...page.data.map(like => like.actor)] : page.data.map(like => like.actor);
      target.people = [...new Map(merged.map(person => [person.did, person])).values()];
      target.cursor = page.has_more && page.next_cursor && page.next_cursor !== cursor ? page.next_cursor : undefined;
      target.loaded = true;
      if (!more) target.at = now();
    } catch {
      if (target.generation === ask) target.error = true;
    } finally {
      if (target.generation === ask) { target.loading = false; emit(); }
    }
  }
  return { snapshot: (track: Track) => ({ ...entry(track) }), load, toggle, reset, likers, loadLikers,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
