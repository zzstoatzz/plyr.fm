export type CatalogScope = 'tracks' | 'albums' | 'profile';

const revisions = new Map<string, Partial<Record<CatalogScope, number>>>();
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
}
