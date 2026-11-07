import type { JamTrack, Pending } from './jam-connection';

type Reference = JamTrack & { key: string };
export type DurableQueueEdit =
  | { action: 'enqueue'; entry: Reference }
  | { action: 'removeEntry'; entryKey: string }
  | { action: 'moveEntry'; entryKey: string; beforeKey: string | null }
  | { action: 'clearPicks' }
  | { action: 'shufflePicks'; queue: Reference[] }
  | { action: 'setRepeat'; repeat: 'off' | 'all' | 'one' }
  | { action: 'setContinuation'; keepPlaying: boolean };
export interface QueueMutation {
  id: string;
  intent: DurableQueueEdit;
  base?: Pick<Pending, 'epoch' | 'expectedRevision' | 'occurrence' | 'expectedOutput'>;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function key(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value); }
function reference(value: unknown): Reference | null {
  if (!object(value) || !key(value.key) || typeof value.id !== 'string' || value.id.length > 2048 || !/^trk_[A-Za-z0-9_-]+$/.test(value.id)
    || typeof value.uri !== 'string' || !value.uri.startsWith('at://') || value.uri.length > 1024 || typeof value.cid !== 'string' || value.cid.length > 128
    || typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 86400000) return null;
  return { id: value.id, uri: value.uri, cid: value.cid, durationMs: value.durationMs, key: value.key };
}
export function durableQueueEdit(value: unknown): DurableQueueEdit | null {
  if (!object(value)) return null;
  switch (value.action) {
    case 'enqueue': { const entry = reference(value.entry); return entry ? { action: 'enqueue', entry } : null; }
    case 'removeEntry': return key(value.entryKey) ? { action: 'removeEntry', entryKey: value.entryKey } : null;
    case 'moveEntry': return key(value.entryKey) && (value.beforeKey === null || key(value.beforeKey)) ? { action: 'moveEntry', entryKey: value.entryKey, beforeKey: value.beforeKey } : null;
    case 'clearPicks': return { action: 'clearPicks' };
    case 'shufflePicks': {
      if (!Array.isArray(value.queue) || value.queue.length > 200) return null;
      const queue: Reference[] = [];
      for (const item of value.queue) { const entry = reference(item); if (!entry || queue.some(previous => previous.key === entry.key)) return null; queue.push(entry); }
      return { action: 'shufflePicks', queue };
    }
    case 'setRepeat': return value.repeat === 'off' || value.repeat === 'all' || value.repeat === 'one' ? { action: 'setRepeat', repeat: value.repeat } : null;
    case 'setContinuation': return typeof value.keepPlaying === 'boolean' ? { action: 'setContinuation', keepPlaying: value.keepPlaying } : null;
    default: return null;
  }
}
export function queueMutations(value: unknown, owner: string): QueueMutation[] {
  if (!object(value) || value.owner !== owner || !Array.isArray(value.entries) || value.entries.length > 64) return [];
  const entries: QueueMutation[] = [];
  for (const candidate of value.entries) {
    if (!object(candidate) || !key(candidate.id) || entries.some(entry => entry.id === candidate.id)) continue;
    const intent = durableQueueEdit(candidate.intent);
    if (!intent) continue;
    let base: QueueMutation['base'];
    if (candidate.base !== undefined) {
      const value = candidate.base;
      if (!object(value) || !key(value.epoch) || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0
        || typeof value.occurrence !== 'number' || !Number.isSafeInteger(value.occurrence) || value.occurrence < 0
        || value.expectedOutput !== null && !key(value.expectedOutput)) continue;
      base = { epoch: value.epoch, expectedRevision: value.expectedRevision, occurrence: value.occurrence, expectedOutput: value.expectedOutput };
    }
    entries.push({ id: candidate.id, intent, ...(base ? { base } : {}) });
  }
  return entries;
}

export function mergeQueueMutations(previous: QueueMutation[], entries: QueueMutation[], remove: string[] = []): QueueMutation[] {
  const merged = new Map(previous.map(entry => [entry.id, entry]));
  for (const entry of entries) {
    const known = merged.get(entry.id);
    merged.set(entry.id, known ? { ...known, base: known.base ?? entry.base } : entry);
  }
  for (const id of remove) merged.delete(id);
  if (merged.size > 64) throw new Error('Connect before adding more queue changes');
  return [...merged.values()];
}
