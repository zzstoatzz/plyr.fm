import type { Page, Track } from './api.ts';
import { EarlyIntents } from './early-intents.ts';
import { jamPosition, type JamConnectionOptions, type JamState, type PlaybackIntent } from './jam-connection.ts';
import { PersonalQueue, queueReference } from './personal-queue.ts';
import { recordPlayback } from './playback-diagnostics.ts';
import { queueCheckpoint, type QueueCheckpoint, type QueueStorage } from './queue-checkpoint.ts';
import { QueueContinuation } from './queue-continuation.ts';
import * as queue from './queue-state.ts';

export interface PersonalPlaybackTarget {
  current?: Track;
  ready: boolean;
  position(): number;
  playing(): boolean;
  load(tracks: Track[], index: number): Promise<boolean>;
  loaded(): Promise<void>;
  seek(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  setQueue(tracks: Track[], index: number): void;
  suspended: boolean;
  repeat: QueueCheckpoint['repeat'];
  keepPlaying: boolean;
  duration(): number;
  setRepeat(value: QueueCheckpoint['repeat']): void;
  error(message: string): void;
}

export type QueueSeed = ReturnType<PersonalQueue['seed']>;

export interface PersonalPlaybackAccount {
  did: string | null;
  ready: boolean;
  accountSync: boolean;
  join?(client: string, initial: QueueSeed | undefined, resumePlaying: boolean): ReturnType<JamConnectionOptions['admit']>;
}

interface Options {
  target(): PersonalPlaybackTarget;
  account(): PersonalPlaybackAccount;
  storage: QueueStorage;
  id(): string;
  resolve(ids: string[], signal?: AbortSignal): Promise<{ data: Track[]; missing: string[] }>;
  recent(cursor?: string, signal?: AbortSignal): Promise<Page<Track>>;
  consumeLogin(): boolean;
  socket: NonNullable<JamConnectionOptions['socket']>;
}

interface Snapshot {
  state: queue.QueueState<Track>;
  remote?: JamState;
  outputElsewhere: boolean;
  restoredPosition?: number;
  queueError?: string;
  waiting: boolean;
}

export function createPersonalPlayback(options: Options) {
  const { target: playback } = options;

  let snapshot: Snapshot = { state: queue.emptyQueue(), waiting: false, outputElsewhere: false };
  const listeners = new Set<() => void>();
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  function update<K extends keyof Snapshot>(key: K, value: Snapshot[K]) {
    if (Object.is(snapshot[key], value)) return;
    snapshot = { ...snapshot, [key]: value };
    for (const listener of listeners) listener();
  }
  let session: PersonalQueue | undefined;
  const client = options.id();
  let generation = 0;
  let loaded = '';
  let synchronization = 0;
  let source = '';
  // A play made before the account queue starts would otherwise hold the loading state until it does, however long that takes.
  const early = new EarlyIntents(intent => {
    const tracks = intent.collection ?? [intent.track];
    const at = Math.max(0, tracks.findIndex(item => item.id === intent.track.id));
    update('waiting', false);
    playback().setQueue(tracks, at);
    void playback().load(tracks, at).then(ready => { if (ready) playback().play(); });
  }, undefined, () => ({ account: source === 'anonymous' ? 'signed out' : source ? 'signed in' : 'not started' }));
  const continuation = new QueueContinuation(options.recent);
  let continuing: Promise<void> | undefined;
  let context = '';
  let owned = false;
  let pausedHere = false;
  let playRequest = 0;
  let pendingPlay: number | undefined;
  let desiredEntry = '';
  let held = false;
  let deferred: { key: string; position: number } | undefined = undefined;

  function start() {
    const auth = options.account();
    if (!auth.ready) return;
    playRequest++;
    pendingPlay = undefined;
    update('waiting', early.hasPlay());
    update('queueError', undefined);
    held = false;
    pausedHere = false;
    const previous = session;
    const account = auth.did ?? 'anonymous';
    const returning = !!auth.did && options.consumeLogin();
    const adopting = !!auth.did && (source === 'anonymous' || returning);
    let adopt: QueueCheckpoint | undefined = adopting && !returning && previous ? { version: 1, owner: account, updatedAt: Date.now(),
      state: previous.state, position: localPosition(), repeat: playback().repeat, keepPlaying: playback().keepPlaying } : undefined;
    previous?.close();
    continuation.reset();
    continuing = undefined;
    context = '';
    source = account;
    const version = ++generation;
    let current: PersonalQueue;
    const stale = () => generation !== version;
    const synchronizing = { key: '', requested: 0 };
    let importing = false;
    let imported = false;
    let adoptAudio = adopting;
    let resuming = false;
    loaded = adopting ? loaded : '';
    owned = false; update('remote', undefined);
    update('outputElsewhere', false);
    deferred = undefined; update('restoredPosition', undefined);
    let skipped = ''; const skip = (reason: string) => { if (reason !== skipped) recordPlayback('queue apply skipped', { reason }); skipped = reason; };

    async function apply(wire: JamState, force: boolean) {
      if (stale() || importing || (playback().suspended || held) || !wire.personal) return skip(stale() ? 'stale' : importing ? 'importing' : held ? 'held' : playback().suspended ? 'suspended' : 'not personal');
      if (pendingPlay !== undefined) {
        if (wire.queue[wire.index]?.key !== desiredEntry || wire.personal.output?.clientId !== client) return skip(wire.queue[wire.index]?.key !== desiredEntry ? 'pending play: other entry' : 'pending play: output elsewhere');
        pendingPlay = undefined;
        update('waiting', false);
        update('state', current.state);
        playback().setQueue(current.state.entries.map(entry => entry.track), current.state.index);
      }
      if (adopt?.state.entries.length && !imported && wire.queue[wire.index]?.key !== adopt.state.entries[adopt.state.index]?.key) return skip('adopting');
      const mine = wire.personal.output?.clientId === client;
      if (mine && resuming) return skip('resuming');
      if (mine && pausedHere && wire.playing) { if (current.online) current.command({ action: 'pause' }); return skip('paused here'); }
      const becameOwner = mine && !owned;
      owned = mine;
      update('outputElsewhere', !!wire.playing && !mine);
      update('remote', wire);
      const scope = wire.queue[0]?.key ?? '';
      if (scope !== context || becameOwner) { context = scope; continuation.reset(wire.personal.cursor); }
      playback().setRepeat(wire.personal.repeat);
      if (!mine) playback().pause();
      const ref = wire.queue[wire.index];
      const track = ref && current.cache.get(ref.id);
      if (!ref || !track) {
        if (ref && current.isMissing(ref.id)) { playback().error('this track is unavailable'); if (mine && wire.playing) current.command({ action: 'pause' }); }
        return skip(!ref ? 'no entry' : current.isMissing(ref.id) ? 'track missing' : 'track not resolved yet');
      }
      if (!mine) { update('restoredPosition', jamPosition(wire, current.position(Date.now())) / 1000); return skip('output elsewhere'); }
      const key = `${wire.epoch}/${wire.occurrence}/${ref.key}/${ref.cid}`;
      if (adoptAudio && playback().ready && playback().current?.id === ref.id && playback().playing()) loaded = key;
      adoptAudio = false;
      const newSource = loaded !== key;
      if (!newSource && !force && !becameOwner) {
        if (mine && wire.playing && !playback().playing()) playback().play();
        else if (!wire.playing) playback().pause();
        return;
      }
      if (synchronizing.key === key) { synchronizing.requested++; return skip('already loading'); }
      synchronizing.key = key;
      skip(''); recordPlayback('queue apply', { newSource, playing: wire.playing });
      const request = ++synchronization;
      const reapply = synchronizing.requested;
      try {
        const position = jamPosition(wire, current.position(Date.now())) / 1000;
        update('restoredPosition', position);
        if (newSource) {
          const tracks = current.state.entries.map(entry => entry.track);
          if (!await playback().load(tracks, current.state.index)) return;
          await playback().loaded();
        }
        if (stale() || request !== synchronization || (playback().suspended || held)) return;
        const latest = current.wire;
        if (!latest || latest.occurrence !== wire.occurrence) return;
        const at = newSource && latest.revision === wire.revision ? wire.positionMs / 1000 : jamPosition(latest, current.position(Date.now())) / 1000;
        if (newSource || Math.abs(playback().position() - at) > 0.75) await playback().seek(at);
        if (stale() || request !== synchronization || (playback().suspended || held)) return;
        const settled = current.wire;
        if (!settled || settled.occurrence !== wire.occurrence) return;
        loaded = key;
        if (newSource && settled.playing && settled.personal?.output?.clientId === client) current.command(progressIntent(current, at));
        update('restoredPosition', undefined);
        if (settled.personal?.output?.clientId === client && settled.playing && !pausedHere) playback().play();
        else playback().pause();
      } catch (error) { if (!stale()) playback().error(error instanceof Error ? error.message : 'could not restore playback'); }
      finally {
        synchronizing.key = '';
        if (!stale() && (reapply !== synchronizing.requested || current.wire?.occurrence !== wire.occurrence) && current.wire) void apply(current.wire, true);
      }
    }

    const join = auth.accountSync ? auth.join : undefined;
    current = new PersonalQueue({ owner: account, storage: options.storage, id: options.id, client: client,
      resolve: options.resolve,
      error: message => { if (!stale()) update('queueError', message); },
      changed: (state, checkpoint) => {
        if (stale() || importing || pendingPlay !== undefined || early.length) return;
        if (adopt?.state.entries.length && !imported && current.wire && current.wire.queue[current.wire.index]?.key !== adopt.state.entries[adopt.state.index]?.key) return;
        update('state', state);
        if ((playback().suspended || held)) return;
        playback().setQueue(state.entries.map(entry => entry.track), state.index);
        if (checkpoint && (!auth.did || !auth.accountSync) && state.entries.length && (!adopting || returning)) {
          playback().setRepeat(checkpoint.repeat);
          synchronization++;
          const entry = state.entries[state.index];
          const length = entry.track.metadata.duration_seconds;
          const position = length && checkpoint.position > length - 5 ? 0 : checkpoint.position;
          deferred = { key: entry.key, position };
          update('restoredPosition', position);
        }
      },
      connected: async wire => {
        update('queueError', undefined);
        if (pausedHere && wire.personal?.output?.clientId === client && wire.playing) {
          resuming = false;
          await current.dispatch({ action: 'pause' });
          if (current.wire) void apply(current.wire, true);
          return;
        }
        if (wire.revision === 0 && wire.queue.length === 0 && wire.personal?.keepPlaying !== playback().keepPlaying) void current.edit({ action: 'setContinuation', keepPlaying: playback().keepPlaying });
        if (resuming) {
          resuming = false;
          if (wire.personal?.output?.clientId === client) await current.dispatch(progressIntent(current, playback().position()));
          if (current.wire) void apply(current.wire, false);
        }
        if (imported || !adopt?.state.entries.length) return;
        imported = true;
        if (wire.queue[wire.index]?.key === adopt.state.entries[adopt.state.index]?.key) return;
        importing = true;
        try {
          const state = adopt.state;
          current.remember(state.entries.map(entry => entry.track));
          for (const entry of state.entries.slice(state.index + 1, queue.explicitEnd(state))) await current.edit({ action: 'enqueue', entry: queueReference(entry.track, entry.key) });
          if (pendingPlay !== undefined) return;
          const result = await current.dispatch({ action: 'playContext', queue: state.entries.map(entry => queueReference(entry.track, entry.key)),
            index: state.index, label: state.tail?.label, playing: !returning && playback().playing(), positionMs: Math.round(adopt.position * 1000) });
          if (!result) playback().error('could not restore your listening queue');
        } catch { playback().error('could not restore your listening queue'); }
        finally {
          importing = false;
          if (!stale()) { update('state', current.state); if (!(playback().suspended || held)) playback().setQueue(current.state.entries.map(entry => entry.track), current.state.index); }
          if (current.wire) void apply(current.wire, true);
        }
      },
      remote: (state, force) => { if (!stale()) { update('remote', state); void apply(state, force); } },
      ...(auth.did && join ? { connect: { socket: options.socket, admit: () => {
        resuming = owned && playback().playing() && !(playback().suspended || held);
        return join(client, current.wire ? undefined : { ...current.seed(), playing: adopting && playback().playing() }, resuming);
      } } } : {}),
    });
    session = current;
    const starting = returning ? options.storage.load('anonymous').then(value => {
      const checkpoint = queueCheckpoint(value, 'anonymous');
      if (checkpoint) adopt = { ...checkpoint, owner: account };
      if (!stale()) return current.start(adopt);
    }).catch(() => { if (!stale()) return current.start(); }) : current.start(adopt);
    void Promise.resolve(starting).catch(() => {}).then(() => {
      if (stale()) return;
      for (const intent of early.drain()) {
        if (intent.kind === 'play') play(intent.track, intent.collection, intent.label);
        else enqueue(intent.track);
      }
    });

    return () => {
      if (stale()) return;
      synchronization++;
      playRequest++;
      pendingPlay = undefined;
      checkpoint();
      current.close();
      generation++;
    };
  }

  function keepPlaying() { return session?.wire?.personal?.keepPlaying ?? playback().keepPlaying; }
  function save() {
    const target = playback();
    if (session?.initialized && !target.suspended) void session.save(snapshot.restoredPosition ?? target.position(), target.repeat, keepPlaying());
  }
  function tick() {
    const current = session;
    const target = playback();
    if (!current || target.suspended || held) return;
    checkpoint();
    if (owned && target.playing()) current.command(progressIntent(current, target.position()));
  }
  async function prepareLogin() {
    const target = playback();
    if (!session || target.suspended || held) return false;
    await session.save(localPosition(), target.repeat, keepPlaying());
    return source === 'anonymous';
  }
  function refresh() { if (!playback().suspended) session?.refresh(); }
  function configureContinuation() {
    const remote = snapshot.remote;
    if (!keepPlaying()) continuation.reset(remote?.personal?.cursor);
    if (!remote && session && !playback().keepPlaying && session.state.tail?.kind === 'generated') session.local(queue.trimGenerated(session.state));
  }
  function hasRemoteClock() {
    return !!snapshot.remote?.playing && !owned && !playback().suspended && !held;
  }

  function position() {
    const current = session;
    return current?.wire && !owned ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition();
  }
  function localPosition() {
    const pending = deferred;
    const state = session?.state;
    return pending && state?.entries[state.index]?.key === pending.key ? pending.position : playback().position();
  }
  function forget() {
    if (!deferred) return;
    deferred = undefined;
    update('restoredPosition', undefined);
  }
  function defer(position: number) {
    const pending = deferred;
    const current = session;
    if (!pending || !current || current.state.entries[current.state.index]?.key !== pending.key) return false;
    deferred = { key: pending.key, position };
    update('restoredPosition', position);
    current.progress(position);
    return true;
  }
  function resume() {
    const current = session;
    const pending = deferred;
    if (!current || !pending || current.synchronized || current.state.entries[current.state.index]?.key !== pending.key) return false;
    pausedHere = false;
    const request = ++synchronization;
    const active = () => request === synchronization && current === session;
    void playback().load(current.state.entries.map(entry => entry.track), current.state.index).then(async ready => {
      if (!ready || !active()) return;
      await playback().loaded();
      if (!active()) return;
      await playback().seek((deferred?.key === pending.key ? deferred : pending).position);
      if (!active()) return;
      forget();
      if (!pausedHere) playback().play();
    }).catch(() => playback().error('could not restore playback'));
    return true;
  }
  function duration() {
    const current = session;
    const wire = current?.wire;
    return wire ? wire.queue[wire.index]?.durationMs / 1000 || current?.state.entries[current.state.index]?.track.metadata.duration_seconds || (owned ? playback().duration() : 0) : playback().duration();
  }

  function progressIntent(current: PersonalQueue, position: number): PlaybackIntent {
    const entry = current.wire?.queue[current.wire.index];
    const durationMs = Math.round(playback().duration() * 1000);
    return { action: 'progress', positionMs: Math.round(position * 1000),
      ...(entry && durationMs > 0 && durationMs <= 86400000 ? { entry: { ...entry, durationMs } } : {}) };
  }

  async function fillContinuation() {
    const current = session;
    if (!current || (playback().suspended || held) || !keepPlaying() || current.wire && !owned) return;
    const entries = current.state.entries;
    const remaining = entries.length - current.state.index - 1;
    if (!entries.length || remaining > 2) return;
    const scope = context;
    const seen = new Set(entries.map(entry => entry.track.id));
    await continuation.prefetch(seen);
    if (session !== current || scope !== context || (playback().suspended || held) || !keepPlaying()) return;
    if (current.state.tail?.kind === 'collection' && current.state.index + 1 < current.state.entries.length) return;
    const fresh = continuation.peek(new Set(current.state.entries.map(entry => entry.track.id)));
    if (!fresh.length) return;
    current.remember(fresh);
    const entriesToAppend = fresh.map(track => ({ track, key: options.id() }));
    if (current.wire) {
      if (!owned || !await current.dispatch({ action: 'appendContinuation', queue: entriesToAppend.map(entry => queueReference(entry.track, entry.key)), cursor: continuation.nextCursor })) return;
    } else current.local(queue.appendContinuation(current.state, entriesToAppend));
    continuation.consumed(new Set(fresh.map(track => track.id)));
  }
  function ensureContinuation() {
    continuing ??= fillContinuation().catch(() => playback().error('could not load more tracks')).finally(() => { continuing = undefined; });
    return continuing;
  }

  async function next(explicit = true) {
    if (!explicit && pausedHere) return;
    if (explicit) pausedHere = false;
    const current = session;
    if (!current || (playback().suspended || held)) return;
    if (current.wire && !owned) return;
    if (current.state.index + 1 >= current.state.entries.length && playback().repeat !== 'all') await ensureContinuation();
    if (current !== session || (playback().suspended || held)) return;
    if (current.wire) { await current.dispatch({ action: 'advance' }); return; }
    if (current.state.index + 1 < current.state.entries.length) select(current.state.index + 1);
    else if (playback().repeat === 'all' && current.state.entries.length) select(0);
    else playback().pause();
  }

  function command(intent: PlaybackIntent) {
    if (intent.action === 'pause') { pausedHere = true; playRequest++; pendingPlay = undefined; update('waiting', false); }
    else if (intent.action === 'play') pausedHere = false;
    if (intent.action === 'play' && held) { held = false; loaded = ''; }
    const current = session;
    if (intent.action === 'play' && current?.synchronized && !current.online) {
      const request = ++playRequest;
      update('waiting', true);
      void current.whenConnected().then(async connected => {
        if (request !== playRequest || current !== session) return;
        const accepted = connected && await current.dispatch({ action: 'play' });
        if (request !== playRequest || current !== session) return;
        update('waiting', false);
        if (!accepted) playback().error('could not resume playback. please try again.');
      });
      return true;
    }
    const handled = current?.command(intent) ?? false;
    if (handled && intent.action === 'play' && owned && !playback().ready) { loaded = ''; current?.refresh(); }
    return handled;
  }
  function local(state: queue.QueueState<Track>) { session?.local(state); }
  function remember(tracks: Track[]) { session?.remember(tracks); }
  function play(track: Track, collection?: Track[], label?: string) {
    held = false;
    pausedHere = false;
    forget();
    const current = session;
    if (!current || source !== (options.account().did ?? 'anonymous')) {
      early.play({ track, collection, label });
      update('waiting', true);
      playback().setQueue([track], 0);
      return true;
    }
    continuation.reset();
    continuing = undefined;
    const tracks = collection ?? [track];
    remember(tracks);
    const entries = tracks.map(track => ({ track, key: options.id() }));
    const index = tracks.indexOf(track);
    const at = index >= 0 ? index : tracks.findIndex(item => item.id === track.id);
    context = entries[at]?.key ?? '';
    const state = queue.switchContext(current.state, entries, at, label);
    if (current.synchronized) {
      const request = ++playRequest;
      pendingPlay = request; desiredEntry = entries[at].key;
      update('waiting', true);
      update('state', state); playback().setQueue(state.entries.map(entry => entry.track), state.index); playback().pause();
      void (async () => {
        if (!await current.whenConnected(5_000)) return 'offline';
        if (request !== playRequest || current !== session) return false;
        return current.dispatch({ action: 'playContext', queue: entries.map(entry => queueReference(entry.track, entry.key)), index: at, label, playing: true });
      })().then(accepted => {
        if (request !== playRequest || current !== session) return;
        // Local playback never waits on the account queue: play here, and hand the queue this play once it connects.
        if (accepted === 'offline') { pendingPlay = undefined; update('waiting', false); local(state); void playback().load(state.entries.map(entry => entry.track), state.index).then(ready => { if (ready) playback().play(); });
          void current.whenConnected(120_000).then(connected => { if (connected && request === playRequest && current === session) void current.dispatch({ action: 'playContext', queue: entries.map(entry => queueReference(entry.track, entry.key)), index: at, label, playing: !pausedHere, positionMs: Math.round(playback().position() * 1000) }); }); return; }
        const applied = pendingPlay === undefined && current.wire?.queue[current.wire.index]?.key === entries[at].key;
        pendingPlay = undefined; update('waiting', false);
        if (!applied) {
          update('state', current.state);
          playback().setQueue(current.state.entries.map(entry => entry.track), current.state.index);
          current.refresh();
        }
        if (!accepted && current.wire?.queue[current.wire.index]?.key !== entries[at].key) playback().error('could not start playback. please try again.');
      }).catch(() => {
        if (request === playRequest) { pendingPlay = undefined; update('waiting', false); current.refresh(); playback().error('could not start playback'); }
      });
      return true;
    }
    update('waiting', false);
    local(state);
    void playback().load(state.entries.map(entry => entry.track), state.index).then(ready => { if (ready) playback().play(); });
    return true;
  }
  function enqueue(track: Track) {
    if (!session || source !== (options.account().did ?? 'anonymous')) { early.enqueue(track); return; }
    remember([track]);
    edit({ action: 'enqueue', entry: queueReference(track, options.id()) });
  }
  function edit(intent: Parameters<PersonalQueue['edit']>[0]) { void session?.edit(intent); }
  function select(at: number) {
    pausedHere = false;
    forget();
    const current = session;
    const entry = current?.state.entries[at];
    if (!entry || !current) return;
    if (!command({ action: 'selectTrack', entryKey: entry.key, playing: true })) {
      local({ ...current.state, index: at });
      void playback().load(current.state.entries.map(entry => entry.track), at).then(ready => { if (ready) playback().play(); });
    }
  }
  function checkpoint(position?: number) {
    const current = session;
    if (current && !(playback().suspended || held)) current.progress(position ?? (current.wire && !owned
      ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition()));
  }
  function suspend() {
    const current = session;
    const entry = current?.state.entries[current.state.index];
    if (!held && !playback().suspended) {
      checkpoint();
      if (entry && !current?.wire) deferred = { key: entry.key, position: localPosition() };
    }
    held = true;
    playRequest++;
    pendingPlay = undefined;
    update('waiting', false);
    if (owned) command({ action: 'pause' });
    owned = false;
    synchronization++;
  }

  function restore() {
    held = false;
    const current = session;
    if (!current) return;
    playback().setQueue(current.state.entries.map(entry => entry.track), current.state.index);
    if (current.wire) {
      loaded = '';
      update('restoredPosition', position());
      if (current.wire.personal?.output?.clientId === client && current.wire.playing) command({ action: 'pause' });
    } else if (deferred) update('restoredPosition', position());
  }

  return { subscribe, getSnapshot: () => snapshot, start, save, tick, prepareLogin, refresh, configureContinuation,
    ensureContinuation, hasRemoteClock, keepPlaying,
    diagnose: () => ({ waiting: snapshot.waiting, pendingPlay: pendingPlay !== undefined, session: !!session, synchronized: !!session?.synchronized, online: !!session?.online, owned: owned, early: early.length }), unstick: () => { playRequest++; pendingPlay = undefined; early.drain(); update('waiting', false); }, position, duration, setKeepPlaying: (value: boolean) => edit({ action: 'setContinuation', keepPlaying: value }), checkpoint, ownsOutput: () => owned, next, resume, defer, command, play, select, local, remember,
    enqueue,
    remove: (at: number) => { const entry = session?.state.entries[at]; if (entry) edit({ action: 'removeEntry', entryKey: entry.key }); },
    move: (from: number, to: number) => {
      const entries = session?.state.entries;
      if (!entries?.[from] || !entries[to]) return;
      edit({ action: 'moveEntry', entryKey: entries[from].key, beforeKey: entries[from < to ? to + 1 : to]?.key ?? null });
    },
    clear: () => edit({ action: 'clearPicks' }),
    shuffle: () => { const current = session; if (current) edit({ action: 'shufflePicks', queue: queue.shufflePicks(current.state).entries.slice(current.state.index + 1, queue.explicitEnd(current.state)).map(entry => queueReference(entry.track, entry.key)) }); },
    setRepeat: (repeat: QueueCheckpoint['repeat']) => { playback().setRepeat(repeat); edit({ action: 'setRepeat', repeat }); },
    suspend, restore,
  };
}
