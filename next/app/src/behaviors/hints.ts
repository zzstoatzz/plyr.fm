export interface HintSpec<Id extends string = string> {
  id: Id;
  /** Hints that must have been seen first. A tour is a chain of these. */
  after?: readonly Id[];
}

/**
 * The hint to show now: the first in registry order that hasn't been seen, whose
 * target is on screen and ready, and whose prerequisites have all been seen.
 * At most one hint shows at a time, so a newly ready hint waits for the current one.
 */
export function nextHint<Id extends string>(specs: readonly HintSpec<Id>[], seen: ReadonlySet<string>, ready: ReadonlySet<string>, current?: Id): Id | undefined {
  if (current && !seen.has(current) && ready.has(current)) return current;
  return specs.find(spec => !seen.has(spec.id) && ready.has(spec.id) && (spec.after ?? []).every(id => seen.has(id)))?.id;
}

export function seenKey(did: string | null) {
  return `hints:seen:${did ?? 'signed-out'}`;
}

export function parseSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
