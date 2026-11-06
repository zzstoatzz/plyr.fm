export interface JamTrack {
  id: string;
  uri: string;
  cid: string;
  durationMs: number;
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
}

export type JamIntent =
  | { action: 'play' | 'pause' }
  | { action: 'seek'; positionMs: number }
  | { action: 'replaceQueue'; queue: JamTrack[]; index: number; playing?: boolean }
  | { action: 'selectTrack'; index: number; playing?: boolean };

type Pending = JamIntent & { id: string; epoch: string; expectedRevision: number; occurrence: number };
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

export function isJamState(value: unknown): value is JamState {
  if (!record(value) || typeof value.epoch !== 'string' || typeof value.occurrence !== 'number'
      || typeof value.playing !== 'boolean' || !Array.isArray(value.queue) || value.queue.length > 200) return false;
  if (![value.revision, value.index, value.occurrence, value.positionMs, value.updatedAtMs].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return false;
  if ((value.index as number) >= Math.max(1, value.queue.length)) return false;
  if (!value.queue.length && (value.index !== 0 || value.playing || value.positionMs !== 0)) return false;
  return value.queue.every(track => record(track) && typeof track.id === 'string' && typeof track.uri === 'string'
    && typeof track.cid === 'string' && typeof track.durationMs === 'number' && Number.isSafeInteger(track.durationMs) && track.durationMs > 0 && track.durationMs <= 86_400_000);
}

export function jamPosition(state: JamState, serverNowMs: number): number {
  const elapsed = state.playing ? Math.max(0, serverNowMs - state.updatedAtMs) : 0;
  const duration = state.queue[state.index]?.durationMs ?? 0;
  return Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, state.positionMs + elapsed));
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
  onResult?: (intent: JamIntent, outcome: string) => void;
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
            if (message.outcome === 'applied' && sent && revision === sent.expectedRevision + 1) {
              for (const pending of this.pending) if (pending.epoch === sent.epoch && pending.occurrence === sent.occurrence && pending.expectedRevision === sent.expectedRevision) pending.expectedRevision = revision;
            } else if (message.outcome !== 'applied' && message.outcome !== 'noop' && message.outcome !== 'duplicate') {
              this.options.onError(message.outcome === 'forbidden' ? 'Only the host can seek in this Jam' : 'The Jam changed. Try that action again.');
            }
            if (sent) this.options.onResult?.(sent, String(message.outcome));
            this.inFlight = undefined;
            clearTimeout(this.commandTimer);
            this.flush();
          }
        } catch { this.options.onError('Could not read the Jam update'); }
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
      this.options.onError(failure instanceof Error ? failure.message : 'Could not connect to the Jam. Retrying…');
      this.reconnectAttempt++;
      this.reconnectTimer = setTimeout(() => void this.connect(), Math.min(10_000, 500 * this.reconnectAttempt));
    }
  }

  command(intent: JamIntent, expected?: Pick<JamState, 'epoch' | 'revision' | 'occurrence'>): boolean {
    if (this.awaitingSnapshot || !this.state || this.socket?.readyState !== 1 || this.closed) { this.options.onError('The Jam is reconnecting'); return false; }
    const base = expected ?? this.state;
    const command = { ...intent, id: `${Math.floor(this.now()).toString(36)}-${++this.serial}-${Math.random().toString(36).slice(2, 10)}`, epoch: base.epoch,
      expectedRevision: base.revision, occurrence: base.occurrence };
    if (intent.action === 'seek') this.pending = this.pending.filter(pending => pending.action !== 'seek');
    if (this.pending.length >= 16) { this.options.onError('Waiting for the Jam to catch up'); return false; }
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
    if (next.epoch !== this.state?.epoch || next.occurrence !== this.state?.occurrence) { this.flush(); return; }
    const duplicateIntent = next.expectedRevision < this.state!.revision && (next.action === 'play' && this.state!.playing || next.action === 'pause' && !this.state!.playing);
    if (next.expectedRevision !== this.state?.revision && !duplicateIntent) { this.pending = []; this.options.onError('The Jam changed. Try that action again.'); return; }
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
