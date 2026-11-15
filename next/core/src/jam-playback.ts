import type { Track } from './api.ts';
import { JamConnection, jamPosition, type JamConnectionOptions, type JamIntent, type JamPhase, type JamState, type JamTrack } from './jam-connection.ts';

export interface JamPlaybackTarget {
  queue: Track[];
  index: number;
  current?: Track;
  ready: boolean;
  buffering: boolean;
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

interface JamPlaybackOptions {
  target(): JamPlaybackTarget;
  did: string | null;
  socket: NonNullable<JamConnectionOptions['socket']>;
  track(id: string): Promise<Track>;
  changed(jam: ActiveJam | undefined): void;
}

export function createJamPlayback(options: JamPlaybackOptions) {
  const { target } = options;
  let session: JamConnection | undefined;
  let active: ActiveJam | undefined;
  let generation = 0;
  const cache = new Map<string, Track>();
  let occurrence = '';
  let corrections = 0;
  let progressSample: { key: string; position: number; at: number } | undefined;
  let optimisticPlaying: boolean | undefined;
  let synchronizing = false;
  let synchronization = 0;
  let syncingKey = '';
  let stateVersion = 0;
  let pendingSync: { state: JamState; force: boolean; connection: JamConnection; version: number } | undefined;
  const fetching = new Map<string, Promise<Track>>();
  let saved: { queue: Track[]; index: number; position: number } | undefined;
  let previousAccount = options.did;

  function update(change: Partial<ActiveJam>) {
    if (!active) return;
    if ((Object.keys(change) as (keyof ActiveJam)[]).every(key => active?.[key] === change[key])) return;
    active = { ...active, ...change };
    options.changed(active);
  }

  async function trackFor(ref: JamTrack): Promise<Track> {
    const key = `${ref.id}/${ref.cid}`;
    const cached = cache.get(key);
    if (cached) return cached;
    let pending = fetching.get(key);
    if (!pending) {
      const account = previousAccount;
      pending = options.track(ref.id).then(track => {
        if (track.record.cid !== ref.cid || track.record.uri !== ref.uri) throw new Error('the jam track has changed');
        if (account === previousAccount) cache.set(key, track);
        return track;
      }).finally(() => fetching.delete(key));
      fetching.set(key, pending);
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
          if (at >= tracks.length || version !== stateVersion) return;
          tracks[at] = await trackFor(state.queue[at]);
        }
      }));
      if (version === stateVersion && connection === session) target().setQueue(tracks, state.index);
    } catch (failure) {
      if (version === stateVersion && connection === session) update({ error: failure instanceof Error ? failure.message : 'could not load the jam queue' });
    }
  }

  function synchronize(state: JamState, force: boolean, connection: JamConnection) {
    const key = `${state.epoch}/${state.occurrence}`;
    if (force) corrections = 0;
    if (syncingKey !== key) {
      generation++;
      synchronization++;
      synchronizing = false;
      syncingKey = key;
    }
    pendingSync = { state, force, connection, version: ++stateVersion };
    void flushSync();
  }

  function latestSync() { return pendingSync; }

  async function flushSync() {
    if (synchronizing) return;
    synchronizing = true;
    const synchronizationId = synchronization;
    try {
      while (pendingSync && synchronizationId === synchronization) {
        let work = pendingSync;
        pendingSync = undefined;
        const request = generation;
        const connection = work.connection;
        const ref = work.state.queue[work.state.index];
        if (!ref) { target().clear(); continue; }
        try {
          const track = await trackFor(ref);
          if (request !== generation || connection !== session) continue;
          const sameOccurrence = () => connection.state?.epoch === work.state.epoch && connection.state?.occurrence === work.state.occurrence;
          if (!sameOccurrence()) continue;
          const changed = occurrence !== `${work.state.epoch}/${work.state.occurrence}` || target().current?.id !== track.id;
          if (changed || !target().ready) {
            occurrence = `${work.state.epoch}/${work.state.occurrence}`;
            if (!await target().load([track], 0)) continue;
            await target().loaded();
          }
          if (request !== generation || connection !== session || !sameOccurrence()) continue;
          const pending = latestSync();
          if (pending?.connection === connection && pending.state.occurrence === work.state.occurrence && pending.state.epoch === work.state.epoch) {
            work = { ...pending, force: work.force || pending.force };
            pendingSync = undefined;
          }
          const state = connection.state!;
          const position = (active?.pendingSeekMs ?? jamPosition(state, connection.clock.serverNow())) / 1000;
          if (changed || Math.abs(target().position() - position) > (work.force ? 0.08 : 0.35)) await target().seek(position);
          if (request !== generation || connection !== session || !sameOccurrence()) continue;
          const desired = optimisticPlaying ?? connection.state!.playing;
          if (desired && !target().playing()) target().play();
          else if (!desired && target().playing()) target().pause();
          void hydrateQueue(connection.state!, work.version, connection);
        } catch (failure) {
          if (request === generation && connection === session) update({ error: failure instanceof Error ? failure.message : 'could not play this jam' });
        }
      }
    } finally { if (synchronizationId === synchronization) synchronizing = false; }
  }

  function leave(restore = true) {
    generation++;
    stateVersion++;
    synchronization++;
    synchronizing = false;
    syncingKey = '';
    pendingSync = undefined;
    session?.close();
    session = undefined;
    active = undefined;
    occurrence = '';
    optimisticPlaying = undefined;
    options.changed(undefined);
    target().pause();
    const solo = saved;
    saved = undefined;
    if (restore && solo?.queue[solo.index]) {
      const request = generation;
      void target().load(solo.queue, solo.index).then(async loaded => {
        if (!loaded || session || request !== generation) return;
        await target().loaded();
        if (!session && request === generation) await target().seek(solo.position);
      }).catch(() => undefined);
    } else target().clear();
  }

  function join(input: { host: string; key: string; admit: () => Promise<{ ticket: string; websocketUrl: string }> }) {
    if (active?.host === input.host && active.key === input.key && session) return;
    const solo = saved ?? { queue: target().queue, index: target().index, position: target().position() };
    if (session) leave(false);
    saved = solo;
    for (const track of target().queue) if (track.record.cid) cache.set(`${track.id}/${track.record.cid}`, track);
    active = { host: input.host, key: input.key, canSeek: previousAccount === input.host, phase: 'connecting' };
    options.changed(active);
    const connection = new JamConnection({
      admit: input.admit, socket: options.socket,
      onState: (state, force) => {
        const before = active?.state;
        if (before?.playing !== state.playing) corrections = 0;
        if (before?.epoch !== state.epoch || before.occurrence !== state.occurrence || optimisticPlaying === state.playing) optimisticPlaying = undefined;
        const preview = active?.pendingSeekMs;
        const changed = before?.epoch !== state.epoch || before.occurrence !== state.occurrence;
        update({ state, error: undefined, ...(changed || preview !== undefined && Math.abs(state.positionMs - preview) < 100 ? { pendingSeekMs: undefined } : {}) });
        synchronize(state, force, connection);
      },
      onResult: (intent, outcome) => {
        if (connection !== session) return;
        if (intent.action === 'play' || intent.action === 'pause') {
          if (optimisticPlaying === (intent.action === 'play')) optimisticPlaying = undefined;
        }
        if (connection.state && ['applied', 'noop', 'duplicate'].includes(outcome)) synchronize(connection.state, false, connection);
      },
      onPhase: phase => {
        if (connection !== session) return;
        if (phase !== 'connected') optimisticPlaying = undefined;
        update({ phase, ...(phase !== 'connected' ? { pendingSeekMs: undefined } : {}) });
      },
      onError: error => { if (connection === session) { optimisticPlaying = undefined; update({ error, pendingSeekMs: undefined }); if (active?.phase === 'connected' && connection.state) synchronize(connection.state, false, connection); } }
    });
    session = connection;
    void connection.connect();
  }

  function command(intent: JamIntent, expected?: JamState) {
    if (!active || !session) return false;
    if (intent.action === 'seek' && !active.canSeek) { update({ error: 'only the host can seek in this jam' }); return true; }
    if (intent.action === 'seek') {
      const room = session.state;
      const duration = room?.queue[room.index]?.durationMs;
      const positionMs = Math.max(0, Math.min(duration ?? intent.positionMs, intent.positionMs));
      update({ pendingSeekMs: positionMs });
      if (!session.command({ action: 'seek', positionMs }, expected)) update({ pendingSeekMs: undefined });
    } else session.command(intent, expected);
    return true;
  }

  function replaceQueue(tracks: Track[], index: number, playing?: boolean) {
    if (!active) return false;
    const refs = tracks.map(jamTrack);
    if (refs.some(track => !track)) { update({ error: 'this track is not ready for the jam' }); return true; }
    for (const track of tracks) if (track.record.cid) cache.set(`${track.id}/${track.record.cid}`, track);
    return command({ action: 'replaceQueue', queue: refs as JamTrack[], index, ...(playing === undefined ? {} : { playing }) });
  }

  function editQueue(edit: (queue: JamTrack[], index: number) => { queue: JamTrack[]; index: number }) {
    if (!active) return false;
    const room = session?.state;
    if (room) command({ action: 'replaceQueue', ...edit(room.queue.slice(), room.index) });
    else update({ error: 'waiting for the jam to connect' });
    return true;
  }

  function setPlaying(desired: boolean, expected?: JamState) {
    if (!active) return false;
    const current = session?.state;
    if (expected && current && (expected.epoch !== current.epoch || expected.occurrence !== current.occurrence || expected.revision !== current.revision && desired !== current.playing)) {
      update({ error: 'the jam changed. try that action again.' });
      return true;
    }
    if (active.phase !== 'connected') return command({ action: desired ? 'play' : 'pause' }, expected);
    optimisticPlaying = desired;
    update({ error: undefined });
    if (target().ready && target().current?.id === active.state?.queue[active.state.index]?.id) {
      try { if (desired) target().play(); else target().pause(); } catch { update({ error: 'tap play to listen to this jam' }); }
    }
    return command({ action: desired ? 'play' : 'pause' }, expected);
  }

  function toggle() {
    if (!active) return false;
    return setPlaying(optimisticPlaying === undefined ? !active.state?.playing || !target().playing() : !optimisticPlaying);
  }

  function observe() {
    const media = target();
    const connection = session;
    const state = connection?.state;
    if (!connection || !state) return;
    const key = `${state.epoch}/${state.occurrence}`;
    const now = performance.now();
    const position = media.position();
    const previous = progressSample;
    progressSample = { key, position, at: now };
    if (!state.playing || !media.ready || media.buffering || !media.playing() || active?.pendingSeekMs !== undefined || optimisticPlaying === false) return;
    if (!previous || previous.key !== key || position - previous.position < 0.02 || now - previous.at < 20) return;
    const drift = Math.abs(position - jamPosition(state, connection.clock.serverNow()) / 1000);
    if (drift <= 0.35) { corrections = 0; return; }
    if (corrections >= 2) { update({ error: 'playback is behind. rejoin this jam to catch up.' }); return; }
    corrections++;
    synchronize(state, false, connection);
  }

  function setAccount(did: string | null) {
    if (previousAccount === did) return;
    previousAccount = did;
    if (session) leave(false);
    cache.clear();
    fetching.clear();
  }

  function close() { generation++; session?.close(); }

  return { join, leave, command, replaceQueue, editQueue, toggle, setPlaying, active: () => !!active,
    state: () => active?.state, observe, setAccount, close };
}
