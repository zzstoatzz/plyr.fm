import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { api, type Track } from './api';
import { useAuth } from './auth';
import { PersonalQueue, queueReference } from './personal-queue';
import { QueueContinuation } from './queue-continuation';
import { joinPersonalQueue } from './personal-queue-join';
import { consumeQueueLogin, registerQueueLogin } from './queue-login';
import { queueStorage } from './queue-storage';
import { jamPosition, type JamState, type PlaybackIntent } from './jam-connection';
import { queueCheckpoint, type QueueCheckpoint } from './queue-checkpoint';
import * as queue from './queue-state';
import type { JamPlaybackTarget } from './use-jam-playback';

interface Target extends Pick<JamPlaybackTarget, 'current' | 'ready' | 'position' | 'playing' | 'load' | 'loaded' | 'seek' | 'play' | 'pause' | 'setQueue'> {
  suspended: boolean;
  repeat: QueueCheckpoint['repeat'];
  keepPlaying: boolean;
  duration(): number;
  setRepeat(value: QueueCheckpoint['repeat']): void;
  error(message: string): void;
}

export function usePersonalQueue(target: Target) {
  const auth = useAuth();
  const runtime = useRef(target);
  runtime.current = target;
  const session = useRef<PersonalQueue | undefined>(undefined);
  const client = useRef(randomUUID());
  const generation = useRef(0);
  const loaded = useRef('');
  const synchronization = useRef(0);
  const source = useRef('');
  const early = useRef<({ kind: 'play'; track: Track; collection?: Track[]; label?: string } | { kind: 'enqueue'; track: Track })[]>([]);
  const continuation = useRef(new QueueContinuation((cursor, signal) => api.tracks({ limit: 10, cursor }, signal)));
  const continuing = useRef<Promise<void> | undefined>(undefined);
  const context = useRef('');
  const owned = useRef(false);
  const pausedHere = useRef(false);
  const playRequest = useRef(0);
  const pendingPlay = useRef<number | undefined>(undefined);
  const desiredEntry = useRef('');
  const [waiting, setWaiting] = useState(false);
  const [queueError, setQueueError] = useState<string>();
  const held = useRef(false);
  const [state, setState] = useState<queue.QueueState<Track>>(queue.emptyQueue());
  const [remote, setRemote] = useState<JamState>();
  const [, refreshClock] = useState(0);
  const [outputElsewhere, setOutputElsewhere] = useState(false);
  const [restoredPosition, setRestoredPosition] = useState<number>();
  const deferred = useRef<{ key: string; position: number } | undefined>(undefined);

  useEffect(() => {
    if (!auth.ready) return;
    playRequest.current++;
    pendingPlay.current = undefined;
    setWaiting(early.current.some(intent => intent.kind === 'play'));
    setQueueError(undefined);
    held.current = false;
    pausedHere.current = false;
    const previous = session.current;
    const returning = !!auth.did && consumeQueueLogin();
    const adopting = !!auth.did && (source.current === 'anonymous' || returning);
    let adopt: QueueCheckpoint | undefined = adopting && !returning && previous ? { version: 1, owner: auth.did!, updatedAt: Date.now(),
      state: previous.state, position: localPosition(), repeat: runtime.current.repeat, keepPlaying: runtime.current.keepPlaying } : undefined;
    previous?.close();
    continuation.current.reset();
    continuing.current = undefined;
    context.current = '';
    source.current = auth.did ?? 'anonymous';
    const account = source.current;
    const version = ++generation.current;
    let current: PersonalQueue;
    const stale = () => generation.current !== version;
    const synchronizing = { key: '', requested: 0 };
    let importing = false;
    let imported = false;
    let adoptAudio = adopting;
    let resuming = false;
    loaded.current = adopting ? loaded.current : '';
    owned.current = false;
    setRemote(undefined);
    setOutputElsewhere(false);
    deferred.current = undefined;
    setRestoredPosition(undefined);

    async function apply(wire: JamState, force: boolean) {
      if (stale() || importing || (runtime.current.suspended || held.current) || !wire.personal) return;
      if (pendingPlay.current !== undefined) {
        if (wire.queue[wire.index]?.key !== desiredEntry.current || wire.personal.output?.clientId !== client.current) return;
        pendingPlay.current = undefined;
        setWaiting(false);
        setState(current.state);
        runtime.current.setQueue(current.state.entries.map(entry => entry.track), current.state.index);
      }
      if (adopt?.state.entries.length && !imported && wire.queue[wire.index]?.key !== adopt.state.entries[adopt.state.index]?.key) return;
      const mine = wire.personal.output?.clientId === client.current;
      if (mine && resuming) return;
      if (mine && pausedHere.current && wire.playing) { if (current.online) current.command({ action: 'pause' }); return; }
      const becameOwner = mine && !owned.current;
      owned.current = mine;
      setOutputElsewhere(!!wire.playing && !mine);
      setRemote(wire);
      const scope = wire.queue[0]?.key ?? '';
      if (scope !== context.current || becameOwner) { context.current = scope; continuation.current.reset(wire.personal.cursor); }
      runtime.current.setRepeat(wire.personal.repeat);
      if (!mine) runtime.current.pause();
      const ref = wire.queue[wire.index];
      const track = ref && current.cache.get(ref.id);
      if (!ref || !track) {
        if (ref && current.isMissing(ref.id)) { runtime.current.error('this track is unavailable'); if (mine && wire.playing) current.command({ action: 'pause' }); }
        return;
      }
      if (!mine) { setRestoredPosition(jamPosition(wire, current.position(Date.now())) / 1000); return; }
      const key = `${wire.epoch}/${wire.occurrence}/${ref.key}/${ref.cid}`;
      if (adoptAudio && runtime.current.ready && runtime.current.current?.id === ref.id && runtime.current.playing()) loaded.current = key;
      adoptAudio = false;
      const newSource = loaded.current !== key;
      if (!newSource && !force && !becameOwner) {
        if (mine && wire.playing && !runtime.current.playing()) runtime.current.play();
        else if (!wire.playing) runtime.current.pause();
        return;
      }
      if (synchronizing.key === key) { synchronizing.requested++; return; }
      synchronizing.key = key;
      const request = ++synchronization.current;
      const reapply = synchronizing.requested;
      try {
        const position = jamPosition(wire, current.position(Date.now())) / 1000;
        setRestoredPosition(position);
        if (newSource) {
          const tracks = current.state.entries.map(entry => entry.track);
          if (!await runtime.current.load(tracks, current.state.index)) return;
          await runtime.current.loaded();
        }
        if (stale() || request !== synchronization.current || (runtime.current.suspended || held.current)) return;
        const latest = current.wire;
        if (!latest || latest.occurrence !== wire.occurrence) return;
        const at = newSource && latest.revision === wire.revision ? wire.positionMs / 1000 : jamPosition(latest, current.position(Date.now())) / 1000;
        if (newSource || Math.abs(runtime.current.position() - at) > 0.75) await runtime.current.seek(at);
        if (stale() || request !== synchronization.current || (runtime.current.suspended || held.current)) return;
        const settled = current.wire;
        if (!settled || settled.occurrence !== wire.occurrence) return;
        loaded.current = key;
        if (newSource && settled.playing && settled.personal?.output?.clientId === client.current) current.command(progressIntent(current, at));
        setRestoredPosition(undefined);
        if (settled.personal?.output?.clientId === client.current && settled.playing && !pausedHere.current) runtime.current.play();
        else runtime.current.pause();
      } catch (error) { if (!stale()) runtime.current.error(error instanceof Error ? error.message : 'could not restore playback'); }
      finally {
        synchronizing.key = '';
        if (!stale() && (reapply !== synchronizing.requested || current.wire?.occurrence !== wire.occurrence) && current.wire) void apply(current.wire, true);
      }
    }

    current = new PersonalQueue({ owner: account, storage: queueStorage, id: randomUUID,
      resolve: (ids, signal) => api.resolveTracks(ids, signal),
      error: message => { if (!stale()) setQueueError(message); },
      changed: (state, checkpoint) => {
        if (stale() || importing || pendingPlay.current !== undefined || early.current.length) return;
        if (adopt?.state.entries.length && !imported && current.wire && current.wire.queue[current.wire.index]?.key !== adopt.state.entries[adopt.state.index]?.key) return;
        setState(state);
        if ((runtime.current.suspended || held.current)) return;
        runtime.current.setQueue(state.entries.map(entry => entry.track), state.index);
        if (checkpoint && (!auth.did || !auth.accountSync) && state.entries.length && (!adopting || returning)) {
          runtime.current.setRepeat(checkpoint.repeat);
          synchronization.current++;
          const entry = state.entries[state.index];
          const length = entry.track.metadata.duration_seconds;
          const position = length && checkpoint.position > length - 5 ? 0 : checkpoint.position;
          deferred.current = { key: entry.key, position };
          setRestoredPosition(position);
        }
      },
      connected: async wire => {
        setQueueError(undefined);
        if (pausedHere.current && wire.personal?.output?.clientId === client.current && wire.playing) {
          resuming = false;
          await current.dispatch({ action: 'pause' });
          if (current.wire) void apply(current.wire, true);
          return;
        }
        if (wire.revision === 0 && wire.queue.length === 0 && wire.personal?.keepPlaying !== runtime.current.keepPlaying) void current.edit({ action: 'setContinuation', keepPlaying: runtime.current.keepPlaying });
        if (resuming) {
          resuming = false;
          if (wire.personal?.output?.clientId === client.current) await current.dispatch(progressIntent(current, runtime.current.position()));
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
          if (pendingPlay.current !== undefined) return;
          const result = await current.dispatch({ action: 'playContext', queue: state.entries.map(entry => queueReference(entry.track, entry.key)),
            index: state.index, label: state.tail?.label, playing: !returning && runtime.current.playing(), positionMs: Math.round(adopt.position * 1000) });
          if (!result) runtime.current.error('could not restore your listening queue');
        } catch { runtime.current.error('could not restore your listening queue'); }
        finally {
          importing = false;
          if (!stale()) { setState(current.state); if (!(runtime.current.suspended || held.current)) runtime.current.setQueue(current.state.entries.map(entry => entry.track), current.state.index); }
          if (current.wire) void apply(current.wire, true);
        }
      },
      remote: (state, force) => { if (!stale()) { setRemote(state); void apply(state, force); } },
      ...(auth.did && auth.agent && auth.accountSync ? { connect: { admit: () => {
        resuming = owned.current && runtime.current.playing() && !(runtime.current.suspended || held.current);
        return joinPersonalQueue(auth, client.current, current.wire ? undefined : { ...current.seed(), playing: adopting && runtime.current.playing() }, resuming);
      } } } : {}),
    });
    session.current = current;
    const starting = returning ? queueStorage.load('anonymous').then(value => {
      const checkpoint = queueCheckpoint(value, 'anonymous');
      if (checkpoint) adopt = { ...checkpoint, owner: account };
      if (!stale()) return current.start(adopt);
    }).catch(() => { if (!stale()) return current.start(); }) : current.start(adopt);
    void starting.then(() => {
      if (stale()) return;
      for (const intent of early.current.splice(0)) {
        if (intent.kind === 'play') play(intent.track, intent.collection, intent.label);
        else enqueue(intent.track);
      }
    });

    return () => {
      synchronization.current++;
      playRequest.current++;
      pendingPlay.current = undefined;
      current.progress(current.wire && !owned.current ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition());
      current.close();
      generation.current++;
    };
  }, [auth.ready, auth.did, auth.agent, auth.accountSync]);

  useEffect(() => {
    if (!session.current?.initialized || target.suspended) return;
    session.current.save(restoredPosition ?? target.position(), target.repeat, keepPlaying());
  }, [state, target.repeat, target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = session.current;
      if (!current || (runtime.current.suspended || held.current)) return;
      current.progress(current.wire && !owned.current ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition());
      if (owned.current && runtime.current.playing()) current.command(progressIntent(current, runtime.current.position()));
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => registerQueueLogin(async () => {
    const current = session.current;
    if (!current || (runtime.current.suspended || held.current)) return false;
    await current.save(localPosition(), runtime.current.repeat, keepPlaying());
    return source.current === 'anonymous';
  }), []);

  useEffect(() => {
    const save = () => {
      const current = session.current;
      if (current && !(runtime.current.suspended || held.current)) current.progress(current.wire && !owned.current
        ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition());
    };
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') save(); });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', save);
    return () => { subscription.remove(); if (typeof window !== 'undefined') window.removeEventListener('pagehide', save); };
  }, []);

  useEffect(() => { if (!target.suspended) session.current?.refresh(); }, [target.suspended]);

  function keepPlaying() { return session.current?.wire?.personal?.keepPlaying ?? runtime.current.keepPlaying; }
  useEffect(() => {
    const current = session.current;
    if (!keepPlaying()) continuation.current.reset(remote?.personal?.cursor);
    if (!remote && current && !target.keepPlaying && current.state.tail?.kind === 'generated') current.local(queue.trimGenerated(current.state));
  }, [target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);

  useEffect(() => {
    if (!remote?.playing || owned.current || target.suspended || held.current) return;
    const timer = setInterval(() => refreshClock(value => value + 1), 250);
    return () => clearInterval(timer);
  }, [remote?.playing, remote?.personal?.output?.clientId, target.suspended, held.current]);

  function position() {
    const current = session.current;
    return current?.wire && !owned.current ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition();
  }
  function localPosition() {
    const pending = deferred.current;
    const state = session.current?.state;
    return pending && state?.entries[state.index]?.key === pending.key ? pending.position : runtime.current.position();
  }
  function forget() {
    if (!deferred.current) return;
    deferred.current = undefined;
    setRestoredPosition(undefined);
  }
  function defer(position: number) {
    const pending = deferred.current;
    const current = session.current;
    if (!pending || !current || current.state.entries[current.state.index]?.key !== pending.key) return false;
    deferred.current = { key: pending.key, position };
    setRestoredPosition(position);
    current.progress(position);
    return true;
  }
  function resume() {
    const current = session.current;
    const pending = deferred.current;
    if (!current || !pending || current.synchronized || current.state.entries[current.state.index]?.key !== pending.key) return false;
    pausedHere.current = false;
    const request = ++synchronization.current;
    const active = () => request === synchronization.current && current === session.current;
    void runtime.current.load(current.state.entries.map(entry => entry.track), current.state.index).then(async ready => {
      if (!ready || !active()) return;
      await runtime.current.loaded();
      if (!active()) return;
      await runtime.current.seek((deferred.current?.key === pending.key ? deferred.current : pending).position);
      if (!active()) return;
      forget();
      if (!pausedHere.current) runtime.current.play();
    }).catch(() => runtime.current.error('could not restore playback'));
    return true;
  }
  function duration() {
    const current = session.current;
    const wire = current?.wire;
    return wire ? wire.queue[wire.index]?.durationMs / 1000 || current?.state.entries[current.state.index]?.track.metadata.duration_seconds || (owned.current ? runtime.current.duration() : 0) : runtime.current.duration();
  }

  function progressIntent(current: PersonalQueue, position: number): PlaybackIntent {
    const entry = current.wire?.queue[current.wire.index];
    const durationMs = Math.round(runtime.current.duration() * 1000);
    return { action: 'progress', positionMs: Math.round(position * 1000),
      ...(entry && durationMs > 0 && durationMs <= 86400000 ? { entry: { ...entry, durationMs } } : {}) };
  }

  async function fillContinuation() {
    const current = session.current;
    if (!current || (runtime.current.suspended || held.current) || !keepPlaying() || current.wire && !owned.current) return;
    const entries = current.state.entries;
    const remaining = entries.length - current.state.index - 1;
    if (!entries.length || remaining > 2) return;
    const scope = context.current;
    const seen = new Set(entries.map(entry => entry.track.id));
    await continuation.current.prefetch(seen);
    if (session.current !== current || scope !== context.current || (runtime.current.suspended || held.current) || !keepPlaying()) return;
    if (current.state.tail?.kind === 'collection' && current.state.index + 1 < current.state.entries.length) return;
    const fresh = continuation.current.peek(new Set(current.state.entries.map(entry => entry.track.id)));
    if (!fresh.length) return;
    current.remember(fresh);
    const entriesToAppend = fresh.map(track => ({ track, key: randomUUID() }));
    if (current.wire) {
      if (!owned.current || !await current.dispatch({ action: 'appendContinuation', queue: entriesToAppend.map(entry => queueReference(entry.track, entry.key)), cursor: continuation.current.nextCursor })) return;
    } else current.local(queue.appendContinuation(current.state, entriesToAppend));
    continuation.current.consumed(new Set(fresh.map(track => track.id)));
  }
  function ensureContinuation() {
    continuing.current ??= fillContinuation().catch(() => runtime.current.error('could not load more tracks')).finally(() => { continuing.current = undefined; });
    return continuing.current;
  }
  useEffect(() => { void ensureContinuation(); }, [state, target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);

  async function next(explicit = true) {
    if (!explicit && pausedHere.current) return;
    if (explicit) pausedHere.current = false;
    const current = session.current;
    if (!current || (runtime.current.suspended || held.current)) return;
    if (current.wire && !owned.current) return;
    if (current.state.index + 1 >= current.state.entries.length && runtime.current.repeat !== 'all') await ensureContinuation();
    if (current !== session.current || (runtime.current.suspended || held.current)) return;
    if (current.wire) { await current.dispatch({ action: 'advance' }); return; }
    if (current.state.index + 1 < current.state.entries.length) select(current.state.index + 1);
    else if (runtime.current.repeat === 'all' && current.state.entries.length) select(0);
    else runtime.current.pause();
  }

  function command(intent: PlaybackIntent) {
    if (intent.action === 'pause') { pausedHere.current = true; playRequest.current++; pendingPlay.current = undefined; setWaiting(false); }
    else if (intent.action === 'play') pausedHere.current = false;
    if (intent.action === 'play' && held.current) { held.current = false; loaded.current = ''; }
    const current = session.current;
    if (intent.action === 'play' && current?.synchronized && !current.online) {
      const request = ++playRequest.current;
      setWaiting(true);
      void current.whenConnected().then(async connected => {
        if (request !== playRequest.current || current !== session.current) return;
        const accepted = connected && await current.dispatch({ action: 'play' });
        if (request !== playRequest.current || current !== session.current) return;
        setWaiting(false);
        if (!accepted) runtime.current.error('could not resume playback. please try again.');
      });
      return true;
    }
    const handled = current?.command(intent) ?? false;
    if (handled && intent.action === 'play' && owned.current && !runtime.current.ready) { loaded.current = ''; current?.refresh(); }
    return handled;
  }
  function local(state: queue.QueueState<Track>) { session.current?.local(state); }
  function remember(tracks: Track[]) { session.current?.remember(tracks); }
  function play(track: Track, collection?: Track[], label?: string) {
    held.current = false;
    pausedHere.current = false;
    forget();
    const current = session.current;
    if (!current || source.current !== (auth.did ?? 'anonymous')) {
      early.current = early.current.filter(intent => intent.kind !== 'play');
      early.current.push({ kind: 'play', track, collection, label });
      setWaiting(true);
      runtime.current.setQueue([track], 0);
      return true;
    }
    continuation.current.reset();
    continuing.current = undefined;
    const tracks = collection ?? [track];
    remember(tracks);
    const entries = tracks.map(track => ({ track, key: randomUUID() }));
    const index = tracks.indexOf(track);
    const at = index >= 0 ? index : tracks.findIndex(item => item.id === track.id);
    context.current = entries[at]?.key ?? '';
    const state = queue.switchContext(current.state, entries, at, label);
    if (current.synchronized) {
      const request = ++playRequest.current;
      pendingPlay.current = request;
      desiredEntry.current = entries[at].key;
      setWaiting(true);
      setState(state);
      runtime.current.setQueue(state.entries.map(entry => entry.track), state.index);
      runtime.current.pause();
      void (async () => {
        if (!await current.whenConnected() || request !== playRequest.current || current !== session.current) return false;
        return current.dispatch({ action: 'playContext', queue: entries.map(entry => queueReference(entry.track, entry.key)), index: at, label, playing: true });
      })().then(accepted => {
        if (request !== playRequest.current || current !== session.current) return;
        const applied = pendingPlay.current === undefined && current.wire?.queue[current.wire.index]?.key === entries[at].key;
        pendingPlay.current = undefined;
        setWaiting(false);
        if (!applied) {
          setState(current.state);
          runtime.current.setQueue(current.state.entries.map(entry => entry.track), current.state.index);
          current.refresh();
        }
        if (!accepted && current.wire?.queue[current.wire.index]?.key !== entries[at].key) runtime.current.error('could not start playback. please try again.');
      }).catch(() => {
        if (request === playRequest.current) { pendingPlay.current = undefined; setWaiting(false); current.refresh(); runtime.current.error('could not start playback'); }
      });
      return true;
    }
    setWaiting(false);
    local(state);
    void runtime.current.load(state.entries.map(entry => entry.track), state.index).then(ready => { if (ready) runtime.current.play(); });
    return true;
  }
  function enqueue(track: Track) {
    if (!session.current || source.current !== (auth.did ?? 'anonymous')) { if (early.current.length < 64) early.current.push({ kind: 'enqueue', track }); return; }
    remember([track]);
    edit({ action: 'enqueue', entry: queueReference(track, randomUUID()) });
  }
  function edit(intent: Parameters<PersonalQueue['edit']>[0]) { void session.current?.edit(intent); }
  function select(at: number) {
    pausedHere.current = false;
    forget();
    const current = session.current;
    const entry = current?.state.entries[at];
    if (!entry || !current) return;
    if (!command({ action: 'selectTrack', entryKey: entry.key, playing: true })) {
      local({ ...current.state, index: at });
      void runtime.current.load(current.state.entries.map(entry => entry.track), at).then(ready => { if (ready) runtime.current.play(); });
    }
  }
  function checkpoint(position?: number) {
    const current = session.current;
    if (current && !(runtime.current.suspended || held.current)) current.progress(position ?? (current.wire && !owned.current
      ? jamPosition(current.wire, current.position(Date.now())) / 1000 : localPosition()));
  }
  return { position, duration, keepPlaying: remote?.personal?.keepPlaying ?? target.keepPlaying, setKeepPlaying: (value: boolean) => edit({ action: 'setContinuation', keepPlaying: value }), queueError, waiting, deviceOnly: !!auth.did && !auth.accountSync, checkpoint, ownsOutput: () => owned.current, next, state, remote, outputElsewhere, restoredPosition, resume, defer, command, play, select, local, remember,
    enqueue,
    remove: (at: number) => { const entry = session.current?.state.entries[at]; if (entry) edit({ action: 'removeEntry', entryKey: entry.key }); },
    move: (from: number, to: number) => {
      const entries = session.current?.state.entries;
      if (!entries?.[from] || !entries[to]) return;
      edit({ action: 'moveEntry', entryKey: entries[from].key, beforeKey: entries[from < to ? to + 1 : to]?.key ?? null });
    },
    clear: () => edit({ action: 'clearPicks' }),
    shuffle: () => { const current = session.current; if (current) edit({ action: 'shufflePicks', queue: queue.shufflePicks(current.state).entries.slice(current.state.index + 1, queue.explicitEnd(current.state)).map(entry => queueReference(entry.track, entry.key)) }); },
    setRepeat: (repeat: QueueCheckpoint['repeat']) => { runtime.current.setRepeat(repeat); edit({ action: 'setRepeat', repeat }); },
    suspend: () => { held.current = true; playRequest.current++; pendingPlay.current = undefined; setWaiting(false); if (owned.current) command({ action: 'pause' }); owned.current = false; synchronization.current++; },
    restore: () => { held.current = false; const current = session.current; if (current) { runtime.current.setQueue(current.state.entries.map(entry => entry.track), current.state.index); if (current.wire) { loaded.current = ''; if (current.wire.personal?.output?.clientId === client.current && current.wire.playing) command({ action: 'pause' }); } } },
  };
}
