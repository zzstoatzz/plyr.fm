import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './auth-state';
import { nextHint, parseSeen, seenKey, type HintSpec } from './behaviors/hints';
import { readLocal, writeLocal } from './storage';

/** Every one-time hint in the app, in priority order. A screen shows one with `useHint(id, ready)`. */
export const hints = [
  { id: 'now-playing.more-below' },
] as const satisfies readonly HintSpec[];

export type HintId = typeof hints[number]['id'];

let account: string | null | undefined;
let seen = new Set<string>();
const ready = new Set<string>();
let current: HintId | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function settle() {
  const next = account === undefined ? undefined : nextHint(hints, seen, ready, current);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function useAccount(did: string | null, known: boolean) {
  useEffect(() => {
    if (!known || account === did) return;
    account = did;
    seen = parseSeen(readLocal(seenKey(did)));
    current = undefined;
    settle();
  }, [did, known]);
}

export function markHintSeen(id: HintId) {
  if (account === undefined || seen.has(id)) return;
  seen = new Set(seen).add(id);
  writeLocal(seenKey(account), JSON.stringify([...seen]));
  settle();
}

export function resetHints() {
  if (account === undefined) return;
  seen = new Set();
  writeLocal(seenKey(account), '[]');
  settle();
}

/**
 * Whether this screen's hint is the one to show. Pass `isReady` false while the target is off screen, moving or
 * covered; the hint waits. `dismiss` marks it seen for this account on this device, as does doing the thing it teaches.
 */
export function useHint(id: HintId, isReady = true) {
  const auth = useAuth();
  useAccount(auth.did, auth.ready);
  useEffect(() => {
    if (!isReady) return;
    ready.add(id);
    settle();
    return () => { ready.delete(id); settle(); };
  }, [id, isReady]);
  const shown = useSyncExternalStore(subscribe, () => current === id, () => false);
  return { shown, dismiss: () => markHintSeen(id) };
}
