import { useEffect, useRef, useState } from 'react';
import { api, type Track } from './api';
import { JamConnection, jamPosition, type JamIntent, type JamPhase, type JamState, type JamTrack } from './jam-connection';

export interface JamPlaybackTarget {
  queue: Track[];
  index: number;
  current?: Track;
  ready: boolean;
  buffering: boolean;
  observedPosition: number;
  position(): number;
  playing(): boolean;
  load(tracks: Track[], index: number): Promise<boolean>;
  loaded(): Promise<void>;
  seek(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  setQueue(tracks: Track[], index: number): void;
  clear(): void;
}

export interface ActiveJam {
  host: string;
  key: string;
  canSeek: boolean;
  phase: JamPhase;
  state?: JamState;
  pendingSeekMs?: number;
  error?: string;
}

export function jamTrack(track: Track, mediaDuration?: number): JamTrack | null {
  if (track.access.visibility === 'private' || track.record.uri.includes('/space/')) return null;
  const duration = mediaDuration && mediaDuration > 0 ? mediaDuration : track.metadata.duration_seconds ?? 0;
  return track.record.cid && duration > 0 && duration <= 86_400 ? { id: track.id, uri: track.record.uri, cid: track.record.cid,
    durationMs: Math.max(0, Math.round(duration * 1000)) } : null;
}

export function useJamPlayback(target: JamPlaybackTarget, did: string | null) {
  const runtime = useRef(target);
  runtime.current = target;
  const session = useRef<JamConnection | undefined>(undefined);
  const active = useRef<ActiveJam | undefined>(undefined);
  const generation = useRef(0);
  const cache = useRef(new Map<string, Track>());
  const occurrence = useRef('');
  const corrections = useRef(0);
  const progressSample = useRef<{ key: string; position: number; at: number } | undefined>(undefined);
  const optimisticPlaying = useRef<boolean | undefined>(undefined);
  const synchronizing = useRef(false);
  const synchronization = useRef(0);
  const syncingKey = useRef('');
  const stateVersion = useRef(0);
  const pendingSync = useRef<{ state: JamState; force: boolean; connection: JamConnection; version: number } | undefined>(undefined);
  const fetching = useRef(new Map<string, Promise<Track>>());
  const saved = useRef<{ queue: Track[]; index: number; position: number } | undefined>(undefined);
  const [jam, setJam] = useState<ActiveJam>();
  const previousAccount = useRef(did);

  function update(change: Partial<ActiveJam>) {
    if (!active.current) return;
    if ((Object.keys(change) as (keyof ActiveJam)[]).every(key => active.current?.[key] === change[key])) return;
    active.current = { ...active.current, ...change };
    setJam(active.current);
  }

  async function trackFor(ref: JamTrack): Promise<Track> {
    const key = `${ref.id}/${ref.cid}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    let pending = fetching.current.get(key);
    if (!pending) {
      const account = previousAccount.current;
      pending = api.track(ref.id).then(track => {
        if (track.record.cid !== ref.cid || track.record.uri !== ref.uri) throw new Error('the jam track has changed');
        if (account === previousAccount.current) cache.current.set(key, track);
        return track;
      }).finally(() => fetching.current.delete(key));
      fetching.current.set(key, pending);
    }
    return pending;
  }

  async function hydrateQueue(state: JamState, version: number, connection: JamConnection) {
    const tracks: Track[] = Array(state.queue.length);
    let cursor = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, tracks.length) }, async () => {
        for (;;) {
          const at = cursor++;
          if (at >= tracks.length || version !== stateVersion.current) return;
          tracks[at] = await trackFor(state.queue[at]);
        }
      }));
      if (version === stateVersion.current && connection === session.current) runtime.current.setQueue(tracks, state.index);
    } catch (failure) {
      if (version === stateVersion.current && connection === session.current) update({ error: failure instanceof Error ? failure.message : 'could not load the jam queue' });
    }
  }

  function synchronize(state: JamState, force: boolean, connection: JamConnection) {
    const key = `${state.epoch}/${state.occurrence}`;
    if (force) corrections.current = 0;
    if (syncingKey.current !== key) {
      generation.current++;
      synchronization.current++;
      synchronizing.current = false;
      syncingKey.current = key;
    }
    pendingSync.current = { state, force, connection, version: ++stateVersion.current };
    void flushSync();
  }

  function latestSync() { return pendingSync.current; }

  async function flushSync() {
    if (synchronizing.current) return;
    synchronizing.current = true;
    const synchronizationId = synchronization.current;
    try {
      while (pendingSync.current && synchronizationId === synchronization.current) {
        let work = pendingSync.current;
        pendingSync.current = undefined;
        const request = generation.current;
        const connection = work.connection;
        const ref = work.state.queue[work.state.index];
        if (!ref) { runtime.current.clear(); continue; }
        try {
          const track = await trackFor(ref);
          if (request !== generation.current || connection !== session.current) continue;
          const sameOccurrence = () => connection.state?.epoch === work.state.epoch && connection.state?.occurrence === work.state.occurrence;
          if (!sameOccurrence()) continue;
          const changed = occurrence.current !== `${work.state.epoch}/${work.state.occurrence}` || runtime.current.current?.id !== track.id;
          if (changed || !runtime.current.ready) {
            occurrence.current = `${work.state.epoch}/${work.state.occurrence}`;
            if (!await runtime.current.load([track], 0)) continue;
            await runtime.current.loaded();
          }
          if (request !== generation.current || connection !== session.current || !sameOccurrence()) continue;
          const pending = latestSync();
          if (pending?.connection === connection && pending.state.occurrence === work.state.occurrence && pending.state.epoch === work.state.epoch) {
            work = { ...pending, force: work.force || pending.force };
            pendingSync.current = undefined;
          }
          const state = connection.state!;
          const position = (active.current?.pendingSeekMs ?? jamPosition(state, connection.clock.serverNow())) / 1000;
          if (changed || Math.abs(runtime.current.position() - position) > (work.force ? 0.08 : 0.35)) await runtime.current.seek(position);
          if (request !== generation.current || connection !== session.current || !sameOccurrence()) continue;
          const desired = optimisticPlaying.current ?? connection.state!.playing;
          if (desired && !runtime.current.playing()) runtime.current.play();
          else if (!desired && runtime.current.playing()) runtime.current.pause();
          void hydrateQueue(connection.state!, work.version, connection);
        } catch (failure) {
          if (request === generation.current && connection === session.current) update({ error: failure instanceof Error ? failure.message : 'could not play this jam' });
        }
      }
    } finally { if (synchronizationId === synchronization.current) synchronizing.current = false; }
  }

  function leave(restore = true) {
    generation.current++;
    stateVersion.current++;
    synchronization.current++;
    synchronizing.current = false;
    syncingKey.current = '';
    pendingSync.current = undefined;
    session.current?.close();
    session.current = undefined;
    active.current = undefined;
    occurrence.current = '';
    optimisticPlaying.current = undefined;
    setJam(undefined);
    runtime.current.pause();
    const solo = saved.current;
    saved.current = undefined;
    if (restore && solo?.queue[solo.index]) {
      const request = generation.current;
      void runtime.current.load(solo.queue, solo.index).then(async loaded => {
        if (!loaded || session.current || request !== generation.current) return;
        await runtime.current.loaded();
        if (!session.current && request === generation.current) await runtime.current.seek(solo.position);
      }).catch(() => undefined);
    } else runtime.current.clear();
  }

  function join(input: { host: string; key: string; admit: () => Promise<{ ticket: string; websocketUrl: string }> }) {
    if (active.current?.host === input.host && active.current.key === input.key && session.current) return;
    const solo = saved.current ?? { queue: runtime.current.queue, index: runtime.current.index, position: runtime.current.position() };
    if (session.current) leave(false);
    saved.current = solo;
    for (const track of runtime.current.queue) if (track.record.cid) cache.current.set(`${track.id}/${track.record.cid}`, track);
    active.current = { host: input.host, key: input.key, canSeek: did === input.host, phase: 'connecting' };
    setJam(active.current);
    const connection = new JamConnection({
      admit: input.admit,
      onState: (state, force) => {
        const before = active.current?.state;
        if (before?.playing !== state.playing) corrections.current = 0;
        if (before?.epoch !== state.epoch || before.occurrence !== state.occurrence || optimisticPlaying.current === state.playing) optimisticPlaying.current = undefined;
        const preview = active.current?.pendingSeekMs;
        const changed = before?.epoch !== state.epoch || before.occurrence !== state.occurrence;
        update({ state, error: undefined, ...(changed || preview !== undefined && Math.abs(state.positionMs - preview) < 100 ? { pendingSeekMs: undefined } : {}) });
        synchronize(state, force, connection);
      },
      onResult: (intent, outcome) => {
        if (connection !== session.current) return;
        if (intent.action === 'play' || intent.action === 'pause') {
          if (optimisticPlaying.current === (intent.action === 'play')) optimisticPlaying.current = undefined;
        }
        if (connection.state && ['applied', 'noop', 'duplicate'].includes(outcome)) synchronize(connection.state, false, connection);
      },
      onPhase: phase => {
        if (connection !== session.current) return;
        if (phase !== 'connected') optimisticPlaying.current = undefined;
        update({ phase, ...(phase !== 'connected' ? { pendingSeekMs: undefined } : {}) });
      },
      onError: error => { if (connection === session.current) { optimisticPlaying.current = undefined; update({ error, pendingSeekMs: undefined }); if (active.current?.phase === 'connected' && connection.state) synchronize(connection.state, false, connection); } }
    });
    session.current = connection;
    void connection.connect();
  }

  function command(intent: JamIntent, expected?: JamState) {
    if (!active.current || !session.current) return false;
    if (intent.action === 'seek' && !active.current.canSeek) { update({ error: 'only the host can seek in this jam' }); return true; }
    if (intent.action === 'seek') {
      const room = session.current.state;
      const duration = room?.queue[room.index]?.durationMs;
      const positionMs = Math.max(0, Math.min(duration ?? intent.positionMs, intent.positionMs));
      update({ pendingSeekMs: positionMs });
      if (!session.current.command({ action: 'seek', positionMs }, expected)) update({ pendingSeekMs: undefined });
    } else session.current.command(intent, expected);
    return true;
  }

  function replaceQueue(tracks: Track[], index: number, playing?: boolean) {
    if (!active.current) return false;
    const refs = tracks.map(jamTrack);
    if (refs.some(track => !track)) { update({ error: 'this track is not ready for the jam' }); return true; }
    for (const track of tracks) if (track.record.cid) cache.current.set(`${track.id}/${track.record.cid}`, track);
    return command({ action: 'replaceQueue', queue: refs as JamTrack[], index, ...(playing === undefined ? {} : { playing }) });
  }

  function editQueue(edit: (queue: JamTrack[], index: number) => { queue: JamTrack[]; index: number }) {
    if (!active.current) return false;
    const room = session.current?.state;
    if (room) command({ action: 'replaceQueue', ...edit(room.queue.slice(), room.index) });
    else update({ error: 'waiting for the jam to connect' });
    return true;
  }

  function setPlaying(desired: boolean, expected?: JamState) {
    if (!active.current) return false;
    const current = session.current?.state;
    if (expected && current && (expected.epoch !== current.epoch || expected.occurrence !== current.occurrence || expected.revision !== current.revision && desired !== current.playing)) {
      update({ error: 'the jam changed. try that action again.' });
      return true;
    }
    if (active.current.phase !== 'connected') return command({ action: desired ? 'play' : 'pause' }, expected);
    optimisticPlaying.current = desired;
    update({ error: undefined });
    if (runtime.current.ready && runtime.current.current?.id === active.current.state?.queue[active.current.state.index]?.id) {
      try { if (desired) runtime.current.play(); else runtime.current.pause(); } catch { update({ error: 'tap play to listen to this jam' }); }
    }
    return command({ action: desired ? 'play' : 'pause' }, expected);
  }

  function toggle() {
    if (!active.current) return false;
    return setPlaying(optimisticPlaying.current === undefined ? !active.current.state?.playing || !runtime.current.playing() : !optimisticPlaying.current);
  }

  const playingHere = target.playing();
  useEffect(() => {
    const connection = session.current;
    const state = connection?.state;
    if (!connection || !state) return;
    const key = `${state.epoch}/${state.occurrence}`;
    const now = performance.now();
    const position = runtime.current.position();
    const previous = progressSample.current;
    progressSample.current = { key, position, at: now };
    if (!state.playing || !target.ready || target.buffering || !playingHere || active.current?.pendingSeekMs !== undefined || optimisticPlaying.current === false) return;
    if (!previous || previous.key !== key || position - previous.position < 0.02 || now - previous.at < 20) return;
    const drift = Math.abs(position - jamPosition(state, connection.clock.serverNow()) / 1000);
    if (drift <= 0.35) { corrections.current = 0; return; }
    if (corrections.current >= 2) { update({ error: 'playback is behind. rejoin this jam to catch up.' }); return; }
    corrections.current++;
    synchronize(state, false, connection);
  }, [jam?.state?.epoch, jam?.state?.occurrence, jam?.state?.playing, jam?.pendingSeekMs, target.ready, target.buffering, target.observedPosition, playingHere]);

  useEffect(() => {
    if (previousAccount.current === did) return;
    previousAccount.current = did;
    if (session.current) leave(false);
    cache.current.clear();
    fetching.current.clear();
  }, [did]);
  useEffect(() => () => { generation.current++; session.current?.close(); }, []);
  return { jam, join, leave, command, replaceQueue, editQueue, toggle, setPlaying, active: () => !!active.current, state: () => active.current?.state };
}
