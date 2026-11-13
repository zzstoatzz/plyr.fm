import { useSyncExternalStore } from 'react';
import type { Auth } from './auth-state';

type Rpc = NonNullable<Auth['rpc']>;
type Interaction = { liked: boolean; busy: boolean };
type Sync = { wanted: boolean; written: boolean };
const sessions = new WeakMap<Rpc, Map<string, Interaction>>();
const syncing = new WeakMap<Rpc, Map<string, Sync>>();
const listeners = new Set<() => void>();

function set(rpc: Rpc, uri: string, state: Interaction) {
  let session = sessions.get(rpc);
  if (!session) { session = new Map(); sessions.set(rpc, session); }
  session.set(uri, state);
  for (const listener of listeners) listener();
}

/**
 * Shows `liked` at once and writes it in the background. Taps that land while a write is in flight only move the target:
 * the writer catches up to the last one, so rapid like/unlike never waits on the network or drops a tap.
 * Resolves for the tap that started the writer, with where it settled; later taps resolve undefined.
 */
export async function wantLike(rpc: Rpc, uri: string, from: boolean, liked: boolean, write: (liked: boolean) => Promise<unknown>) {
  let pending = syncing.get(rpc);
  if (!pending) { pending = new Map(); syncing.set(rpc, pending); }
  set(rpc, uri, { liked, busy: true });
  const running = pending.get(uri);
  if (running) { running.wanted = liked; return undefined; }
  const sync: Sync = { wanted: liked, written: from };
  pending.set(uri, sync);
  let failed = false;
  try {
    while (sync.wanted !== sync.written) {
      const target = sync.wanted;
      await write(target);
      sync.written = target;
    }
  } catch {
    failed = true;
  } finally {
    pending.delete(uri);
    set(rpc, uri, { liked: sync.written, busy: false });
  }
  return { liked: sync.written, changed: sync.written !== from, failed };
}

export function useLikeInteraction(rpc: Auth['rpc'], uri: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => rpc ? sessions.get(rpc)?.get(uri) : undefined, () => undefined);
}
