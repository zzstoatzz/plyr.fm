export interface QueueTrack { id: string }
export interface QueueEntry<T> { key: string; track: T }
export interface QueueTail { from: number; kind: 'collection' | 'generated'; label: string }
export interface QueueState<T> { entries: QueueEntry<T>[]; index: number; tail?: QueueTail }

export function emptyQueue<T>(): QueueState<T> { return { entries: [], index: -1 }; }

export function explicitEnd<T>(state: QueueState<T>): number {
  return Math.max(state.index + 1, state.tail?.from ?? state.entries.length);
}

export function switchContext<T extends QueueTrack>(state: QueueState<T>, entries: QueueEntry<T>[], at: number, label?: string): QueueState<T> {
  const current = entries[at];
  if (!current) return state;
  const picks = state.entries.slice(state.index + 1, explicitEnd(state));
  const ahead = new Set(picks.map(entry => entry.track.id));
  const tail = label ? entries.slice(at + 1).filter(entry => !ahead.has(entry.track.id)) : [];
  return { entries: [current, ...picks, ...tail].slice(0, 200), index: 0,
    ...(label && tail.length ? { tail: { from: 1 + picks.length, kind: 'collection', label } } : {}) };
}

export function compactHistory<T>(state: QueueState<T>, wanted: number): QueueState<T> {
  const drop = Math.min(Math.max(0, state.index), Math.max(0, state.entries.length + wanted - 200));
  return drop ? { ...state, entries: state.entries.slice(drop), index: state.index - drop,
    ...(state.tail ? { tail: { ...state.tail, from: Math.max(0, state.tail.from - drop) } } : {}) } : state;
}

export function enqueue<T>(state: QueueState<T>, entry: QueueEntry<T>): QueueState<T> {
  state = compactHistory(state, 1);
  if (state.entries.length >= 200) return state;
  if (state.entries.some(previous => previous.key === entry.key)) return state;
  const at = explicitEnd(state);
  return { ...state, entries: [...state.entries.slice(0, at), entry, ...state.entries.slice(at)],
    index: state.index < 0 ? 0 : state.index, ...(state.tail ? { tail: { ...state.tail, from: at + 1 } } : {}) };
}

export function appendContinuation<T extends QueueTrack>(state: QueueState<T>, entries: QueueEntry<T>[]): QueueState<T> {
  if (state.tail?.kind === 'collection' && state.index + 1 < state.entries.length) return state;
  const seen = new Set(state.entries.map(entry => entry.track.id));
  const fresh = entries.filter(entry => { if (seen.has(entry.track.id)) return false; seen.add(entry.track.id); return true; });
  if (!fresh.length) return state;
  state = compactHistory(state, fresh.length);
  return { ...state, entries: [...state.entries, ...fresh].slice(0, 200), tail: { from: explicitEnd(state), kind: 'generated', label: 'latest tracks' } };
}

export function trimGenerated<T>(state: QueueState<T>): QueueState<T> {
  if (state.tail?.kind !== 'generated') return state;
  return { entries: state.entries.slice(0, explicitEnd(state)), index: state.index };
}

export function clearPicks<T>(state: QueueState<T>): QueueState<T> {
  const from = state.index + 1;
  const tail = state.entries.slice(explicitEnd(state));
  return { ...state, entries: [...state.entries.slice(0, from), ...tail], ...(state.tail ? { tail: { ...state.tail, from } } : {}) };
}

export function removeEntry<T>(state: QueueState<T>, at: number): QueueState<T> {
  if (at <= state.index || at >= state.entries.length || !Number.isInteger(at)) return state;
  return { ...state, entries: state.entries.filter((_, index) => index !== at),
    ...(state.tail ? { tail: { ...state.tail, from: state.tail.from - Number(at < state.tail.from) } } : {}) };
}

export function moveEntry<T>(state: QueueState<T>, from: number, to: number): QueueState<T> {
  if (![from, to].every(at => Number.isInteger(at) && at > state.index && at < state.entries.length) || from === to) return state;
  const boundary = explicitEnd(state);
  if (from < boundary) to = Math.min(to, boundary - 1);
  if (from === to) return state;
  const entries = state.entries.slice();
  const [entry] = entries.splice(from, 1);
  entries.splice(to, 0, entry);
  return { ...state, entries, ...(state.tail ? { tail: { ...state.tail, from: boundary + Number(from >= boundary && to <= boundary) } } : {}) };
}

export function shufflePicks<T>(state: QueueState<T>, random: () => number = Math.random): QueueState<T> {
  const entries = state.entries.slice();
  for (let at = explicitEnd(state) - 1; at > state.index + 1; at--) {
    const to = state.index + 1 + Math.floor(random() * (at - state.index));
    [entries[at], entries[to]] = [entries[to], entries[at]];
  }
  return { ...state, entries };
}
