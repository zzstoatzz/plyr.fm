export interface TrackRef {
  uri: string;
  cid: string;
}

export interface RoomState {
  revision: number;
  queue: readonly TrackRef[];
  index: number;
  playing: boolean;
  positionMs: number;
  updatedAtMs: number;
}

type Command =
  | { action: 'play' | 'pause'; baseRevision: number }
  | { action: 'seek'; baseRevision: number; positionMs: number }
  | { action: 'replaceQueue'; baseRevision: number; queue: readonly TrackRef[]; index: number }
  | { action: 'selectTrack'; baseRevision: number; index: number };

type Outcome =
  | { outcome: 'applied'; state: RoomState }
  | { outcome: 'forbidden' | 'invalid' | 'conflict'; revision: number };

const maxTracks = 200;
const maxPositionMs = 24 * 60 * 60 * 1000;

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function track(value: unknown, collection: string): TrackRef | null {
  if (!object(value) || typeof value.uri !== 'string' || typeof value.cid !== 'string') return null;
  const parts = value.uri.startsWith('at://') ? value.uri.slice(5).split('/') : [];
  if (parts.length !== 3 || !/^did:(plc|web):[a-zA-Z0-9.:%_-]{1,255}$/.test(parts[0])
      || parts[1] !== collection || !/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(parts[2])
      || !/^b[a-z2-7]{9,127}$/.test(value.cid)) return null;
  return { uri: value.uri, cid: value.cid };
}

function parse(value: unknown, trackCollection: string): Command | null {
  if (!object(value) || !integer(value.baseRevision, 0)) return null;
  const { action, baseRevision } = value;
  if (action === 'play' || action === 'pause') return { action, baseRevision };
  if (action === 'seek' && integer(value.positionMs, 0, maxPositionMs)) {
    return { action, baseRevision, positionMs: value.positionMs };
  }
  if (action === 'selectTrack' && integer(value.index, 0, maxTracks - 1)) {
    return { action, baseRevision, index: value.index };
  }
  if (action !== 'replaceQueue' || !Array.isArray(value.queue) || value.queue.length > maxTracks) return null;
  if (!integer(value.index, 0, Math.max(0, value.queue.length - 1))) return null;
  const queue: TrackRef[] = [];
  for (const item of value.queue) {
    const ref = track(item, trackCollection);
    if (!ref) return null;
    queue.push(ref);
  }
  return { action, baseRevision, index: value.index, queue };
}

export function initialRoom(nowMs: number): RoomState {
  if (!integer(nowMs, 0)) throw new RangeError('invalid host clock');
  return { revision: 0, queue: [], index: 0, playing: false, positionMs: 0, updatedAtMs: nowMs };
}

export function positionAt(state: RoomState, nowMs: number): number {
  const elapsed = state.playing ? Math.max(0, nowMs - state.updatedAtMs) : 0;
  return Math.min(maxPositionMs, state.positionMs + elapsed);
}

export function applyRoomCommand(state: RoomState, input: {
  writerDid: string;
  hostDid: string;
  canWrite: (did: string) => boolean;
  nowMs: number;
  trackCollection: string;
  value: unknown;
}): Outcome {
  const revision = state.revision;
  if (input.writerDid !== input.hostDid && !input.canWrite(input.writerDid)) return { outcome: 'forbidden', revision };
  const command = parse(input.value, input.trackCollection);
  if (!command || !integer(input.nowMs, state.updatedAtMs) || revision >= Number.MAX_SAFE_INTEGER) {
    return { outcome: 'invalid', revision };
  }
  if (command.baseRevision !== revision) return { outcome: 'conflict', revision };

  const next = { ...state, revision: revision + 1, updatedAtMs: input.nowMs, positionMs: positionAt(state, input.nowMs) };
  switch (command.action) {
    case 'replaceQueue': {
      const previous = state.queue[state.index];
      const current = command.queue[command.index];
      if (!previous || !current || previous.uri !== current.uri || previous.cid !== current.cid) next.positionMs = 0;
      next.queue = command.queue;
      next.index = command.index;
      next.playing = !!current && state.playing;
      break;
    }
    case 'selectTrack':
      if (!state.queue[command.index]) return { outcome: 'invalid', revision };
      next.index = command.index;
      next.positionMs = 0;
      break;
    case 'play':
      if (!state.queue[state.index]) return { outcome: 'invalid', revision };
      next.playing = true;
      break;
    case 'pause':
      next.playing = false;
      break;
    case 'seek':
      if (!state.queue[state.index]) return { outcome: 'invalid', revision };
      next.positionMs = command.positionMs;
      break;
  }
  return { outcome: 'applied', state: next };
}
