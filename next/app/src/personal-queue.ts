import type { Track } from './api';
import { JamConnection, type JamConnectionOptions, type JamState, type JamTrack, type Pending, type PlaybackIntent } from './jam-connection.ts';
import { queueCheckpoint, type QueueCheckpoint, type QueueStorage } from './queue-checkpoint.ts';
import type { DurableQueueEdit, QueueMutation } from './queue-mutation';
import * as queue from './queue-state.ts';

export type Reference = JamTrack & { key: string };
export function queueReference(track: Track, key: string): Reference {
  if (!track.record.cid) throw new Error('This track is unavailable');
  return { id: track.id, uri: track.record.uri, cid: track.record.cid, key, durationMs: Math.round((track.metadata.duration_seconds ?? 0) * 1000) };
}

export interface PersonalQueueOptions {
  owner: string;
  storage: QueueStorage;
  id(): string;
  resolve(ids: string[]): Promise<{ data: Track[]; missing: string[] }>;
  changed(state: queue.QueueState<Track>, checkpoint?: QueueCheckpoint): void;
  remote(state: JamState, force: boolean): void;
  error(message: string): void;
  connected?(state: JamState): void;
  connect?: Omit<JamConnectionOptions, 'onState' | 'onPhase' | 'onResult' | 'onError'>;
}

export class PersonalQueue {
  state: queue.QueueState<Track> = queue.emptyQueue();
  wire?: JamState;
  readonly cache = new Map<string, Track>();
  private readonly validated = new Set<string>();
  private readonly missing = new Set<string>();
  private readonly fetching = new Set<string>();
  private connection?: JamConnection;
  private mutations: QueueMutation[] = [];
  private sent?: string;
  private closed = false;
  private connected = false;
  private readonly waiters = new Set<(connected: boolean) => void>();
  private writes: Promise<void> = Promise.resolve();
  private pumping = false;
  private commands = new Map<string, { finish(value: boolean): void; timer: ReturnType<typeof setTimeout> }>();
  private checkpoint?: QueueCheckpoint;
  initialized = false;
  private readonly options: PersonalQueueOptions;

  constructor(options: PersonalQueueOptions) { this.options = options; }

  async start(adopt?: QueueCheckpoint) {
    let restored = adopt;
    try {
      restored ??= queueCheckpoint(await this.options.storage.load(this.options.owner), this.options.owner) ?? undefined;
      this.mutations = await this.options.storage.loadMutations(this.options.owner);
    } catch { this.options.error('Could not restore your saved queue'); }
    if (this.closed) return;
    if (restored) {
      this.checkpoint = restored;
      this.state = restored.state;
      for (const entry of restored.state.entries) this.cache.set(entry.track.id, entry.track);
      this.options.changed(this.state, restored);
    }
    this.initialized = true;
    if (!this.options.connect) return;
    this.connection = new JamConnection({ ...this.options.connect,
      onState: (state, force) => {
        if (!state.personal || this.closed) return;
        console.info('[queue] state', { revision: state.revision, occurrence: state.occurrence, entries: state.queue.length, playing: state.playing });
        this.wire = state;
        this.project();
        this.options.remote(state, force);
        void this.hydrate();
      },
      onPhase: phase => {
        const previous = this.connected;
        this.connected = phase === 'connected';
        if (!previous && this.connected && this.wire) this.options.connected?.(this.wire);
        if (this.connected) for (const finish of this.waiters) finish(true);
        if (!this.connected) this.sent = undefined;
        else void this.pump();
      },
      onError: message => this.options.error(message.replaceAll('The Jam', 'Your queue').replaceAll('the Jam', 'your queue')),
      onResult: (command, outcome) => {
        console.info('[queue] result', { action: command.action, outcome });
        const waiting = this.commands.get(command.id);
        if (waiting) { clearTimeout(waiting.timer); this.commands.delete(command.id); waiting.finish(['applied', 'noop', 'duplicate'].includes(outcome)); }
        if (this.mutations[0]?.id !== command.id) return;
        this.mutations.shift();
        this.sent = undefined;
        void this.persistMutations([command.id]).then(() => this.pump()).catch(() => this.options.error('Could not save your queue change'));
        if (!['applied', 'noop', 'duplicate'].includes(outcome)) this.options.error('Your queue changed. Please try that edit again.');
        this.project();
      },
    });
    await this.connection.connect();
  }

  remember(tracks: Track[]) { for (const track of tracks) { this.cache.set(track.id, track); this.validated.add(track.id); this.missing.delete(track.id); } }
  isMissing(id: string) { return this.missing.has(id); }

  seed() {
    const state = this.state;
    return { queue: state.entries.map(entry => queueReference(entry.track, entry.key)), index: Math.max(0, state.index),
      playing: false, positionMs: Math.round((this.checkpoint?.position ?? 0) * 1000),
      personal: { explicitEnd: queue.explicitEnd(state), tailKind: state.tail?.kind ?? null, label: state.tail?.label ?? null,
        repeat: this.checkpoint?.repeat ?? 'off', keepPlaying: this.checkpoint?.keepPlaying ?? false, cursor: null } };
  }

  local(state: queue.QueueState<Track>) {
    if (this.closed) return;
    this.state = state;
    this.remember(state.entries.map(entry => entry.track));
    this.options.changed(state);
  }

  async edit(intent: DurableQueueEdit) {
    if (this.closed) return;
    if (intent.action === 'enqueue' && this.state.entries.length >= 200 && this.state.index <= 0) { this.options.error('Your queue is full. Remove a track first.'); return; }
    if (this.mutations.length >= 64) { this.options.error('Connect before adding more queue changes'); return; }
    if (!this.options.connect) { this.applyLocal(intent); return; }
    const mutation = { id: this.options.id(), intent };
    this.mutations.push(mutation);
    try { await this.persistMutations(); }
    catch {
      this.mutations = this.mutations.filter(entry => entry !== mutation);
      this.options.error('Could not save your queue change');
      return;
    }
    if (this.closed) return;
    if (this.wire) this.project(); else this.applyLocal(intent);
    await this.pump();
  }

  command(intent: PlaybackIntent): boolean {
    if (!this.options.connect) return false;
    if (!this.connected) { this.options.error('Your queue is reconnecting'); return true; }
    this.connection?.command(intent);
    return true;
  }

  get synchronized() { return !!this.options.connect; }
  whenConnected(): Promise<boolean> {
    if (!this.options.connect || this.connected) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (connected: boolean) => { clearTimeout(timer); this.waiters.delete(finish); resolve(connected); };
      const timer = setTimeout(() => finish(false), 15_000);
      this.waiters.add(finish);
    });
  }

  dispatch(intent: PlaybackIntent): Promise<boolean> {
    if (!this.connected || !this.wire || !this.connection) return Promise.resolve(false);
    const id = this.options.id();
    const wire = this.wire;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.commands.delete(id); resolve(false); }, 10_000);
      this.commands.set(id, { finish: resolve, timer });
      if (!this.connection!.enqueuePrepared({ ...intent, id, epoch: wire.epoch, expectedRevision: wire.revision,
        occurrence: wire.occurrence, expectedOutput: wire.personal?.output?.connectionId ?? null })) {
        clearTimeout(timer); this.commands.delete(id); resolve(false);
      }
    });
  }

  position(now: number) { return this.connection?.clock.serverNow() ?? now; }

  save(position: number, repeat: QueueCheckpoint['repeat'], keepPlaying: boolean) {
    if (this.closed) return;
    const snapshot: QueueCheckpoint = { version: 1, owner: this.options.owner, updatedAt: Date.now(), state: this.state,
      position: this.state.entries.length ? Math.min(86400, Math.max(0, position)) : 0, repeat, keepPlaying };
    this.checkpoint = snapshot;
    this.writes = this.writes.catch(() => {}).then(() => this.options.storage.save(this.options.owner, snapshot));
    void this.writes.catch(() => this.options.error('Could not save your queue'));
    return this.writes;
  }

  progress(position: number) {
    const key = this.state.entries[this.state.index]?.key;
    if (!key || this.closed) return;
    const progress = { key, position: Math.min(86400, Math.max(0, position)), updatedAt: Date.now() };
    this.writes = this.writes.catch(() => {}).then(() => this.options.storage.progress(this.options.owner, progress));
    void this.writes.catch(() => this.options.error('Could not save your playback position'));
  }

  close() {
    this.closed = true;
    this.connection?.close();
    for (const command of this.commands.values()) { clearTimeout(command.timer); command.finish(false); }
    this.commands.clear();
    for (const finish of this.waiters) finish(false);
  }

  private persistMutations(remove: string[] = []) {
    const entries = this.mutations.map(entry => ({ ...entry }));
    const write = this.writes.catch(() => {}).then(() => this.options.storage.saveMutations(this.options.owner, entries, remove)).then(merged => {
      for (const entry of this.mutations) entry.base = merged.find(saved => saved.id === entry.id)?.base ?? entry.base;
    });
    this.writes = write;
    return write;
  }

  private async pump() {
    if (this.pumping || this.closed || !this.connected || this.sent || !this.wire || !this.mutations.length) return;
    this.pumping = true;
    try {
      const head = this.mutations[0];
      head.base ??= { epoch: this.wire.epoch, expectedRevision: this.wire.revision, occurrence: this.wire.occurrence,
        expectedOutput: this.wire.personal?.output?.connectionId ?? null };
      await this.persistMutations();
      if (this.closed || !this.connected || this.mutations[0] !== head) return;
      const command: Pending = { ...head.intent, id: head.id, ...head.base };
      this.sent = head.id;
      if (!this.connection?.enqueuePrepared(command)) this.sent = undefined;
    } catch { this.options.error('Could not send your queue change'); }
    finally { this.pumping = false; }
  }

  private applyLocal(intent: DurableQueueEdit) {
    this.state = this.reduce(this.state, intent);
    this.options.changed(this.state);
  }

  private reduce(state: queue.QueueState<Track>, intent: DurableQueueEdit): queue.QueueState<Track> {
    switch (intent.action) {
      case 'enqueue': { const track = this.cache.get(intent.entry.id); return track ? queue.enqueue(state, { key: intent.entry.key, track }) : state; }
      case 'removeEntry': return queue.removeEntry(state, state.entries.findIndex(entry => entry.key === intent.entryKey));
      case 'moveEntry': {
        const from = state.entries.findIndex(entry => entry.key === intent.entryKey);
        let to = intent.beforeKey ? state.entries.findIndex(entry => entry.key === intent.beforeKey) : state.entries.length;
        if (from < to) to--;
        return queue.moveEntry(state, from, to);
      }
      case 'clearPicks': return queue.clearPicks(state);
      case 'shufflePicks': {
        const picks = state.entries.slice(state.index + 1, queue.explicitEnd(state));
        const byKey = new Map(picks.map(entry => [entry.key, entry]));
        const ordered = intent.queue.flatMap(ref => { const entry = byKey.get(ref.key); byKey.delete(ref.key); return entry ? [entry] : []; });
        return { ...state, entries: [...state.entries.slice(0, state.index + 1), ...ordered, ...byKey.values(), ...state.entries.slice(queue.explicitEnd(state))] };
      }
      case 'setContinuation': return intent.keepPlaying ? state : queue.trimGenerated(state);
      default: return state;
    }
  }

  private project() {
    if (!this.wire?.personal) return;
    const wire = this.wire;
    const personal = wire.personal!;
    for (const ref of wire.queue) {
      const track = this.cache.get(ref.id);
      if (track && track.metadata.duration_seconds === null && ref.durationMs > 0) this.cache.set(ref.id, { ...track, metadata: { ...track.metadata, duration_seconds: ref.durationMs / 1000 } });
    }
    let state: queue.QueueState<Track> = { entries: wire.queue.map(ref => ({ key: ref.key!, track: this.cache.get(ref.id) ?? unavailable(ref) })),
      index: wire.queue.length ? wire.index : -1, ...(personal.tailKind ? { tail: { from: personal.explicitEnd, kind: personal.tailKind, label: personal.label ?? 'latest tracks' } } : {}) };
    for (const mutation of this.mutations) state = this.reduce(state, mutation.intent);
    const previous = this.state;
    const same = previous.index === state.index && previous.entries.length === state.entries.length
      && previous.entries.every((entry, at) => entry.key === state.entries[at].key && entry.track === state.entries[at].track)
      && previous.tail?.from === state.tail?.from && previous.tail?.kind === state.tail?.kind && previous.tail?.label === state.tail?.label;
    if (!same) { this.state = state; this.options.changed(state); }
  }

  refresh() { if (this.wire) { this.project(); this.options.remote(this.wire, true); } }

  private async hydrate() {
    const state = this.wire;
    if (!state) return;
    const ids = [...new Set([...state.queue.slice(state.index), ...state.queue.slice(0, state.index)].map(ref => ref.id))]
      .filter(id => !this.validated.has(id) && !this.missing.has(id) && !this.fetching.has(id));
    const chunks = [ids.slice(0, 100), ids.slice(100, 200)].filter(chunk => chunk.length);
    await Promise.all(chunks.map(async ids => {
      for (const id of ids) this.fetching.add(id);
      try {
        const result = await this.options.resolve(ids);
        if (this.closed) return;
        this.remember(result.data);
        for (const id of result.missing) { this.missing.add(id); this.cache.delete(id); }
        this.project();
        if (this.wire) this.options.remote(this.wire, false);
      } catch { if (!this.closed) this.options.error('Could not load your queue'); }
      finally { for (const id of ids) this.fetching.delete(id); }
    }));
  }
}

function unavailable(ref: JamTrack): Track {
  const parts = ref.uri.slice(5).split('/');
  return { object: 'track', id: ref.id, record: { uri: ref.uri, cid: ref.cid, revision: null, collection: parts[1] ?? '', rkey: parts[2] ?? '' },
    metadata: { title: 'Unavailable track', description: null, album: null, duration_seconds: ref.durationMs / 1000, created_at: '' },
    artist: { did: parts[0] ?? '', profile: { handle: '', display_name: '', avatar_url: null } }, media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 } };
}
