import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, type Artist, type Track, type TrackComment } from './api';
import { getAuth } from './auth-state';
import { createPds } from './pds';

/** One track's timed comments, shared by now playing and the track's own screen. Your own writes show at once and stay until the
 *  appview has indexed them; a comment you deleted stays hidden even if an older answer still lists it. */
interface Entry { server?: TrackComment[]; error: boolean; loading: boolean; mine: TrackComment[]; removed: Set<string>; snapshot: Snapshot }
export interface Snapshot { comments: TrackComment[]; loading: boolean; error: boolean }

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const empty: Snapshot = { comments: [], loading: true, error: false };
const profiles = new Map<string, Promise<Artist | undefined>>();

const byTime = (a: TrackComment, b: TrackComment) => a.timestamp_ms - b.timestamp_ms || a.created_at.localeCompare(b.created_at) || a.record.uri.localeCompare(b.record.uri);

function entry(id: string) {
  let found = entries.get(id);
  if (!found) { found = { error: false, loading: false, mine: [], removed: new Set(), snapshot: empty }; entries.set(id, found); }
  return found;
}

function publish(id: string) {
  const current = entry(id);
  const indexed = new Set(current.server?.map(comment => comment.record.uri));
  current.mine = current.mine.filter(comment => !indexed.has(comment.record.uri));
  const comments = [...(current.server ?? []), ...current.mine].filter(comment => !current.removed.has(comment.record.uri)).sort(byTime);
  current.snapshot = { comments, loading: current.loading && !current.server, error: current.error && !current.server };
  for (const listener of listeners.get(id) ?? []) listener();
}

export function loadComments(id: string) {
  const current = entry(id);
  if (current.loading) return;
  current.loading = true;
  current.error = false;
  publish(id);
  api.trackComments(id).then(page => { current.server = page.data; }, () => { current.error = true; }).finally(() => {
    current.loading = false;
    publish(id);
  });
}

function viewerProfile(did: string) {
  let load = profiles.get(did);
  if (!load) {
    load = api.artist(did).catch(() => undefined);
    profiles.set(did, load);
  }
  return load;
}

export async function addComment(track: Track, text: string, timestampMs: number): Promise<void> {
  const auth = getAuth();
  if (!auth.did || !auth.rpc) throw new Error('sign in to comment');
  const [written, profile] = await Promise.all([createPds(auth).comment(track, text, timestampMs), viewerProfile(auth.did)]);
  const now = new Date().toISOString();
  entry(track.id).mine.push({
    record: { uri: written.uri, cid: written.cid, rkey: written.rkey }, subject: written.subject, text, timestamp_ms: Math.max(0, Math.round(timestampMs)),
    author: { did: auth.did, handle: profile?.handle ?? auth.handle, display_name: profile?.display_name ?? null, avatar_url: profile?.avatar_url ?? null },
    created_at: now, updated_at: null,
  });
  publish(track.id);
}

export async function removeComment(trackId: string, comment: TrackComment): Promise<void> {
  const current = entry(trackId);
  current.removed.add(comment.record.uri);
  publish(trackId);
  try {
    await createPds(getAuth()).deleteComment(comment.record.rkey, comment.record.cid);
  } catch (error) {
    current.removed.delete(comment.record.uri);
    publish(trackId);
    throw error;
  }
}

export function useTrackComments(id: string | undefined): Snapshot & { retry: () => void } {
  const subscribe = useCallback((listener: () => void) => {
    if (!id) return () => {};
    let set = listeners.get(id);
    if (!set) { set = new Set(); listeners.set(id, set); }
    set.add(listener);
    return () => { set.delete(listener); };
  }, [id]);
  const snapshot = useSyncExternalStore(subscribe, () => id ? entry(id).snapshot : empty, () => empty);
  useEffect(() => { if (id && !entry(id).server) loadComments(id); }, [id]);
  const retry = useCallback(() => { if (id) loadComments(id); }, [id]);
  return { ...snapshot, retry };
}
