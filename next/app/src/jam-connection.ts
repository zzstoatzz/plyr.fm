import type { DurableQueueEdit } from './queue-mutation';
export interface JamTrack {
  id: string;
  uri: string;
  cid: string;
  durationMs: number;
  key?: string;
}

export interface PersonalQueueState {
  explicitEnd: number;
  tailKind: 'collection' | 'generated' | null;
  label: string | null;
  repeat: 'off' | 'all' | 'one';
  keepPlaying: boolean;
  cursor: string | null;
  output: { clientId: string; connectionId: string } | null;
  disconnected: boolean;
}

export interface JamState {
  epoch: string;
  revision: number;
  queue: JamTrack[];
  index: number;
  occurrence: number;
  playing: boolean;
  positionMs: number;
  updatedAtMs: number;
  personal?: PersonalQueueState | null;
}

export type JamIntent =
  | { action: 'play' | 'pause' }
  | { action: 'seek'; positionMs: number }
  | { action: 'replaceQueue'; queue: JamTrack[]; index: number; playing?: boolean }
  | { action: 'selectTrack'; index: number; playing?: boolean };

export type PersonalQueueIntent = DurableQueueEdit
  | { action: 'playContext'; queue: (JamTrack & { key: string })[]; index: number; label?: string; playing: boolean; positionMs?: number }
  | { action: 'selectTrack'; entryKey: string; playing?: boolean }
  | { action: 'advance' }
  | { action: 'appendContinuation'; queue: (JamTrack & { key: string })[]; cursor?: string | null }
  | { action: 'progress'; positionMs: number; entry?: JamTrack };

export type PlaybackIntent = JamIntent | PersonalQueueIntent;
export type Pending = PlaybackIntent & { id: string; epoch: string; expectedRevision: number; occurrence: number; expectedOutput?: string | null };
export type JamPhase = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export interface JamSocket {
  readyState: number;
  onopen: WebSocket['onopen'];
  onmessage: WebSocket['onmessage'];
  onclose: WebSocket['onclose'];
  onerror: WebSocket['onerror'];
  send(value: string): void;
  close(): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isPersonalQueue(value: unknown, length: number): value is PersonalQueueState {
  if (!record(value) || !Number.isSafeInteger(value.explicitEnd) || typeof value.explicitEnd !== 'number' || value.explicitEnd < 0 || value.explicitEnd > length
    || (value.repeat !== 'off' && value.repeat !== 'all' && value.repeat !== 'one') || typeof value.keepPlaying !== 'boolean' || typeof value.disconnected !== 'boolean') return false;
  if (value.tailKind !== null && value.tailKind !== 'collection' && value.tailKind !== 'generated') return false;
  if (value.label !== null && (typeof value.label !== 'string' || value.label.length > 200)) return false;
  if (value.cursor !== null && (typeof value.cursor !== 'string' || value.cursor.length > 4096)) return false;
  if (value.output !== null && (!record(value.output) || typeof value.output.clientId !== 'string' || typeof value.output.connectionId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.output.clientId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.output.connectionId))) return false;
  return value.tailKind !== null || value.explicitEnd === length;
}

export function isJamState(value: unknown): value is JamState {
  if (!record(value) || typeof value.epoch !== 'string' || typeof value.occurrence !== 'number'
      || typeof value.playing !== 'boolean' || !Array.isArray(value.queue) || value.queue.length > 200) return false;
  if (![value.revision, value.index, value.occurrence, value.positionMs, value.updatedAtMs].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return false;
  if ((value.index as number) >= Math.max(1, value.queue.length)) return false;
  if (!value.queue.length && (value.index !== 0 || value.playing || value.positionMs !== 0)) return false;
  const personal = value.personal !== undefined && value.personal !== null;
  if (personal && !isPersonalQueue(value.personal, value.queue.length)) return false;
  const keys = new Set<string>();
  return value.queue.every(track => record(track) && typeof track.id === 'string' && typeof track.uri === 'string'
    && typeof track.cid === 'string' && typeof track.durationMs === 'number' && Number.isSafeInteger(track.durationMs) && track.durationMs >= (personal ? 0 : 1) && track.durationMs <= 86_400_000 && (!personal ||
      typeof track.key === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(track.key) && !keys.has(track.key) && !!keys.add(track.key)));
}

export function jamPosition(state: JamState, serverNowMs: number): number {
  const elapsed = state.playing ? Math.max(0, serverNowMs - state.updatedAtMs) : 0;
  const duration = state.queue[state.index]?.durationMs ?? 0;
  const position = state.positionMs + elapsed;
  if (state.personal?.repeat === 'one' && state.playing && duration > 0) return position % duration;
  return Math.max(0, Math.min(duration || (state.personal ? 86_400_000 : Number.MAX_SAFE_INTEGER), position));
}

export class JamClock {
  private offset = 0;
  private samples: { rtt: number; offset: number }[] = [];
  private sampled = false;
  private readonly now: () => number;
  constructor(now: () => number) { this.now = now; }
  observe(serverTimeMs: number, sentAt?: number) {
    const receivedAt = this.now();
    if (!Number.isFinite(serverTimeMs)) return;
    if (sentAt === undefined) { if (!this.sampled) this.offset = serverTimeMs - receivedAt; return; }
    const rtt = receivedAt - sentAt;
    if (rtt < 0 || rtt > 10_000) return;
    this.samples.push({ rtt, offset: serverTimeMs - (sentAt + receivedAt) / 2 });
    this.samples = this.samples.slice(-12);
    this.offset = this.samples.reduce((best, sample) => sample.rtt < best.rtt ? sample : best).offset;
    this.sampled = true;
  }
  serverNow = () => this.now() + this.offset;
}

export interface JamConnectionOptions {
  admit: () => Promise<{ ticket: string; websocketUrl: string }>;
  socket?: (url: string) => JamSocket;
  now?: () => number;
  onState: (state: JamState, force: boolean) => void;
  onPhase: (phase: JamPhase) => void;
  onError: (message: string) => void;
  onResult?: (intent: Pending, outcome: string) => void;
}

export class JamConnection {
  state: JamState | undefined;
  readonly clock: JamClock;
  private socket: JamSocket | undefined;
  private closed = false;
  private awaitingSnapshot = true;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private commandTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Pending | undefined;
  private pending: Pending[] = [];
  private serial = 0;
  private lastMessageAt = 0;
  private readonly readTime: () => number;
  private pings = new Map<string, number>();
  private readonly options: JamConnectionOptions;
  constructor(options: JamConnectionOptions) {
    this.options = options;
    const wall = Date.now();
    const monotonic = performance.now();
    this.readTime = options.now ?? (() => wall + performance.now() - monotonic);
    this.clock = new JamClock(this.readTime);
  }

  async connect() {
    if (this.closed) return;
    const generation = ++this.generation;
    this.awaitingSnapshot = true;
    this.options.onPhase(this.reconnectAttempt ? 'reconnecting' : 'connecting');
    try {
      const admission = await this.options.admit();
      if (this.closed || generation !== this.generation) return;
      const socket = this.options.socket?.(admission.websocketUrl) ?? new WebSocket(admission.websocketUrl);
      this.socket = socket;
      let first = true;
      socket.onopen = () => {
        if (this.closed || generation !== this.generation) { socket.close(); return; }
        this.lastMessageAt = this.now();
        this.snapshotTimer = setTimeout(() => socket.close(), 8_000);
        this.ping();
        this.heartbeat = setInterval(() => {
          if (this.now() - this.lastMessageAt > 30_000) socket.close();
          else this.ping();
        }, 10_000);
      };
      socket.onmessage = event => {
        if (this.closed || generation !== this.generation || socket.readyState !== 1 || typeof event.data !== 'string') return;
        this.lastMessageAt = this.now();
        try {
          const message: unknown = JSON.parse(event.data);
          if (!record(message)) return;
          if (message.type === 'pong' && typeof message.id === 'string' && typeof message.serverTimeMs === 'number') {
            const sent = this.pings.get(message.id);
            if (sent !== undefined) { this.clock.observe(message.serverTimeMs, sent); this.pings.delete(message.id); }
            return;
          }
          if (typeof message.serverTimeMs === 'number') this.clock.observe(message.serverTimeMs);
          if (isJamState(message.state)) {
            const next = message.state;
            const previous = this.state;
            if (!first && previous && next.epoch !== previous.epoch) { socket.close(); return; }
            if (first || !previous || next.revision >= previous.revision) {
              const force = first || previous?.epoch !== next.epoch || previous?.occurrence !== next.occurrence
                || Math.abs(next.positionMs - (previous ? jamPosition(previous, next.updatedAtMs) : next.positionMs)) > 50;
              this.state = next;
              if (first || !previous || previous.epoch !== next.epoch || previous.revision !== next.revision) this.options.onState(next, force);
              first = false;
              this.awaitingSnapshot = false;
              clearTimeout(this.snapshotTimer);
              this.reconnectAttempt = 0;
              this.options.onPhase('connected');
            }
          }
          if (message.type === 'result' && message.id === this.inFlight?.id) {
            const sent = this.inFlight;
            const revision = this.state?.revision;
            if (!this.state?.personal && message.outcome === 'applied' && sent && revision === sent.expectedRevision + 1) {
              for (const pending of this.pending) if (pending.epoch === sent.epoch && pending.occurrence === sent.occurrence && pending.expectedRevision === sent.expectedRevision) pending.expectedRevision = revision;
            } else if (message.outcome !== 'applied' && message.outcome !== 'noop' && message.outcome !== 'duplicate') {
              this.options.onError(message.outcome === 'forbidden' ? 'only the host can seek in this jam' : 'the jam changed. try that action again.');
            }
            if (sent) this.options.onResult?.(sent, String(message.outcome));
            this.inFlight = undefined;
            clearTimeout(this.commandTimer);
            this.flush();
          }
        } catch { this.options.onError('could not read the jam update'); }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (generation !== this.generation) return;
        this.clearSocket();
        if (this.closed) return;
        this.options.onPhase('reconnecting');
        const delay = Math.min(10_000, 250 * 2 ** this.reconnectAttempt++) * (0.5 + Math.random() * 0.5);
        this.reconnectTimer = setTimeout(() => void this.connect(), delay);
      };
    } catch (failure) {
      if (this.closed || generation !== this.generation) return;
      this.options.onError(failure instanceof Error ? failure.message : 'could not connect to the jam. retrying…');
      this.reconnectAttempt++;
      this.reconnectTimer = setTimeout(() => void this.connect(), Math.min(10_000, 500 * this.reconnectAttempt));
    }
  }

  command(intent: PlaybackIntent, expected?: Pick<JamState, 'epoch' | 'revision' | 'occurrence'>): boolean {
    if (this.awaitingSnapshot || !this.state || this.socket?.readyState !== 1 || this.closed) { this.options.onError('the jam is reconnecting'); return false; }
    const base = expected ?? this.state;
    const command = { ...intent, id: `${Math.floor(this.now()).toString(36)}-${++this.serial}-${Math.random().toString(36).slice(2, 10)}`, epoch: base.epoch,
      expectedRevision: base.revision, occurrence: base.occurrence, ...(this.state.personal ? { expectedOutput: this.state.personal.output?.connectionId ?? null } : {}) };
    return this.enqueuePrepared(command);
  }

  enqueuePrepared(command: Pending): boolean {
    if (this.awaitingSnapshot || !this.state || this.socket?.readyState !== 1 || this.closed) return false;
    if (command.action === 'seek') this.pending = this.pending.filter(pending => pending.action !== 'seek');
    if (this.pending.length >= 16) { this.options.onError('waiting for the jam to catch up'); return false; }
    this.pending.push(command);
    this.flush();
    return true;
  }

  close() {
    this.closed = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.clearSocket();
    this.socket?.close();
    this.socket = undefined;
    this.options.onPhase('closed');
  }

  private now() { return this.readTime(); }
  private ping() {
    const id = `clock-${++this.serial}`;
    const clientTimeMs = this.now();
    this.pings.set(id, clientTimeMs);
    if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
    this.socket?.send(JSON.stringify({ type: 'ping', id, clientTimeMs }));
  }
  private flush() {
    if (this.awaitingSnapshot || this.inFlight || !this.pending.length || this.socket?.readyState !== 1) return;
    const next = this.pending.shift()!;
    if (!this.state?.personal && (next.epoch !== this.state?.epoch || next.occurrence !== this.state?.occurrence)) { this.flush(); return; }
    const duplicateIntent = next.expectedRevision < this.state!.revision && (next.action === 'play' && this.state!.playing || next.action === 'pause' && !this.state!.playing);
    if (!this.state?.personal && next.expectedRevision !== this.state?.revision && !duplicateIntent) { this.pending = []; this.options.onError('the jam changed. try that action again.'); return; }
    this.inFlight = next;
    this.socket.send(JSON.stringify(next));
    this.commandTimer = setTimeout(() => this.socket?.close(), 8_000);
  }
  private clearSocket() {
    clearInterval(this.heartbeat);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.commandTimer);
    this.awaitingSnapshot = true;
    this.pings.clear();
    this.pending = [];
    this.inFlight = undefined;
  }
}
