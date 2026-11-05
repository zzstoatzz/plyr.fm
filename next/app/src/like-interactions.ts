import { useSyncExternalStore } from 'react';
import type { Auth } from './auth-state';

type Rpc = NonNullable<Auth['rpc']>;
type Interaction = { liked: boolean; busy: boolean };
const sessions = new WeakMap<Rpc, Map<string, Interaction>>();
const listeners = new Set<() => void>();

export function setLikeInteraction(rpc: Rpc, uri: string, state: Interaction) {
  let session = sessions.get(rpc);
  if (!session) { session = new Map(); sessions.set(rpc, session); }
  session.set(uri, state);
  for (const listener of listeners) listener();
}

export function beginLikeInteraction(rpc: Rpc, uri: string, liked: boolean): boolean {
  if (sessions.get(rpc)?.get(uri)?.busy) return false;
  setLikeInteraction(rpc, uri, { liked, busy: true });
  return true;
}

export function useLikeInteraction(rpc: Auth['rpc'], uri: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => rpc ? sessions.get(rpc)?.get(uri) : undefined, () => undefined);
}
