import { createLatestWriter } from '@plyr/next-core/latest-write';
import { useSyncExternalStore } from 'react';
import type { Auth } from './auth-state';

type Rpc = NonNullable<Auth['rpc']>;
type Interaction = { liked: boolean; busy: boolean };
const sessions = new WeakMap<Rpc, Map<string, Interaction>>();
const writers = new WeakMap<Rpc, ReturnType<typeof createLatestWriter>>();
const listeners = new Set<() => void>();

function set(rpc: Rpc, uri: string, state: Interaction) {
  let session = sessions.get(rpc);
  if (!session) { session = new Map(); sessions.set(rpc, session); }
  session.set(uri, state);
  for (const listener of listeners) listener();
}

/** Shows `liked` at once and writes it in the background (see createLatestWriter). */
export async function wantLike(rpc: Rpc, uri: string, from: boolean, liked: boolean, write: (liked: boolean) => Promise<unknown>) {
  let writer = writers.get(rpc);
  if (!writer) { writer = createLatestWriter(); writers.set(rpc, writer); }
  set(rpc, uri, { liked, busy: true });
  const outcome = await writer.want(uri, from, liked, write);
  if (!outcome) return undefined;
  set(rpc, uri, { liked: outcome.value, busy: false });
  return { liked: outcome.value, changed: outcome.changed, failed: outcome.failed };
}

export function useLikeInteraction(rpc: Auth['rpc'], uri: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => rpc ? sessions.get(rpc)?.get(uri) : undefined, () => undefined);
}
