export type CatalogScope = 'tracks' | 'collections' | 'likes' | 'profile';

const revisions = new Map<string, Partial<Record<CatalogScope, number>>>();
const listeners = new Map<string, Set<() => void>>();
let sequence = 0;

export function catalogRevision(did: string, scope: CatalogScope): number {
  return revisions.get(did)?.[scope] ?? 0;
}

export function catalogChanged(did: string, scope: CatalogScope): void {
  const value = revisions.get(did) ?? {};
  value[scope] = ++sequence;
  revisions.delete(did);
  revisions.set(did, value);
  const oldest = revisions.keys().next().value;
  if (revisions.size > 16 && oldest !== undefined) revisions.delete(oldest);
  for (const listener of listeners.get(did) ?? []) listener();
}

export function subscribeCatalogChanges(did: string, listener: () => void) {
  const actorListeners = listeners.get(did) ?? new Set();
  actorListeners.add(listener);
  listeners.set(did, actorListeners);
  return () => {
    actorListeners.delete(listener);
    if (!actorListeners.size) listeners.delete(did);
  };
}
