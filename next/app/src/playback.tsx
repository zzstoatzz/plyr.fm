import { recordPlayback, urlHost } from './playback-diagnostics';
import { trackArtwork } from './artwork';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { Track } from './api';
import { useAuth } from './auth';
import { getAuth } from './auth-state';
import { editPrivateQueue, isPrivateTrack, privateSpace, withoutPrivateTrack } from './publishing/private-track';
import { blobUrl } from './identity';
import { gatedAudioUrl, releaseGatedAudioUrl } from './gated-audio';
import { useJamPlayback, jamTrack, type ActiveJam } from './use-jam-playback';
import type { JamIntent } from './jam-connection';
import { usePersonalQueue } from './use-personal-queue';
import { usePlayerAccounting } from './use-player-accounting';
import { useMediaSession } from './media-session';
import { useRemoteTrackControls } from './use-remote-track-controls';
import { toast } from './toast';
import { playbackFor, warm } from './playback-lookup';

export function PlaybackProvider({ children, playThrough, keepPlaying, volume }: {
  children: ReactNode; playThrough: boolean; keepPlaying: boolean; volume: number;
}) {
  const auth = useAuth();
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const emittedStatus = useAudioPlayerStatus(player);
  const accounting = usePlayerAccounting(player);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const privateQueue = useRef({ queue, index });
  privateQueue.current = { queue, index };
  const [privatePlayback, setPrivatePlayback] = useState(false);
  const privateMode = useRef(false);
  function privateOutput(value: boolean) { privateMode.current = value; setPrivatePlayback(value); }
  const [resolving, setResolving] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const loading = resolving || starting !== null;
  const [ready, setReady] = useState(false);
  const [lockScreenSuspended, setLockScreenSuspended] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const settings = useRef({ repeat, volume });
  settings.current = { repeat, volume };
  const sourceEvents = useRef<{ remove(): void } | null>(null);
  const sequence = useRef(0);
  const seekRequest = useRef(0);
  const [pendingSeek, setPendingSeek] = useState<{ source: number; seconds: number } | null>(null);
  const objectUrl = useRef<string | null>(null);
  const current = queue[index];
  const status = ready ? emittedStatus : { ...emittedStatus, playing: false, isLoaded: false, didJustFinish: false,
    currentTime: 0, duration: current?.metadata.duration_seconds ?? 0, isBuffering: resolving, error: null };
  useEffect(() => {
    if (pendingSeek && (pendingSeek.source !== sequence.current || status.error ||
      !status.isBuffering && Math.abs(status.currentTime - pendingSeek.seconds) < 0.5)) setPendingSeek(null);
  }, [pendingSeek, status.currentTime, status.isBuffering, status.error, current]);
  const jam = useJamPlayback({
    queue, index, current, ready, buffering: status.isBuffering, observedPosition: status.currentTime,
    position: () => player.currentTime,
    playing: () => player.playing,
    load: (tracks, at) => privateMode.current ? Promise.resolve(false) : load(tracks, at, false),
    loaded: waitForMedia,
    seek: seconds => privateMode.current ? Promise.resolve() : accounting.seekTo(seconds),
    play: () => { if (!privateMode.current) player.play(); },
    pause: () => { if (!privateMode.current) player.pause(); },
    setQueue: (tracks, at) => { if (privateMode.current) return; setQueue(previous => previous.length === tracks.length && previous.every((track, index) => track === tracks[index]) ? previous : tracks); setIndex(at); },
    clear: () => { if (privateMode.current) return; accounting.stop(); sourceEvents.current?.remove(); sequence.current++; player.pause(); player.replace(null); if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current); objectUrl.current = null; setQueue([]); setIndex(-1); setReady(false); setResolving(false); setStarting(null); setError(null); }
  }, auth.did);

  const personal = usePersonalQueue({
    current, ready, duration: () => player.duration,
    position: () => player.currentTime, playing: () => player.playing,
    load: (tracks, at) => privateMode.current ? Promise.resolve(false) : load(tracks, at, false), loaded: waitForMedia,
    seek: seconds => privateMode.current ? Promise.resolve() : accounting.seekTo(seconds), play: () => { if (!privateMode.current) player.play(); }, pause: () => { if (!privateMode.current) player.pause(); },
    setQueue: (tracks, at) => { if (privateMode.current) return; setQueue(previous => previous.length === tracks.length && previous.every((track, index) => track === tracks[index]) ? previous : tracks); setIndex(at); },
    suspended: !!jam.jam || privatePlayback, repeat, keepPlaying, setRepeat, error: setError,
  });

  useEffect(() => {
    if (pendingSeek && personal.remote && Math.abs(personal.remote.positionMs / 1000 - pendingSeek.seconds) < 0.5) setPendingSeek(null);
  }, [personal.remote, pendingSeek]);

  async function waitForMedia() {
    if (player.isLoaded) return;
    const request = sequence.current;
    await new Promise<void>((resolve, reject) => {
      const listener = player.addListener('playbackStatusUpdate', event => {
        if (request !== sequence.current || event.error) { clearTimeout(timer); listener.remove(); reject(new Error('audio changed while loading')); }
        else if (event.isLoaded) { clearTimeout(timer); listener.remove(); resolve(); }
      });
      const timer = setTimeout(() => { listener.remove(); reject(new Error('audio took too long to load')); }, 15_000);
    });
  }

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    }
    return () => {
      sequence.current++;
      sourceEvents.current?.remove();
      if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current);
    };
  }, []);
  const previousAccount = useRef(auth.did);
  const previousRpc = useRef(auth.rpc);
  useEffect(() => {
    const changedSession = previousRpc.current !== auth.rpc;
    previousRpc.current = auth.rpc;
    if (previousAccount.current === auth.did && (!privateMode.current || !changedSession)) return;
    const previous = previousAccount.current;
    previousAccount.current = auth.did;
    if (!previous && auth.did) return;
    privateOutput(false);
    accounting.stop();
    sourceEvents.current?.remove();
    sequence.current++;
    player.pause();
    player.replace(null);
    if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current);
    objectUrl.current = null;
    setQueue([]);
    setIndex(-1);
    setRepeat('off');
    setReady(false);
    setResolving(false);
    setStarting(null);
    setError(null);
  }, [auth.did, auth.rpc, player]);
  useEffect(() => { player.volume = volume; }, [player, volume]);
  useEffect(() => { player.loop = !jam.jam && repeat === 'one'; }, [player, repeat, !!jam.jam]);

  async function load(tracks: Track[], at: number, start = true) {
    const track = tracks[at];
    if (!track) return false;
    const privateTrack = isPrivateTrack(track);
    if (privateTrack !== privateMode.current || tracks.some(item => isPrivateTrack(item) !== privateTrack)) return false;
    if (privateTrack && (!auth.did || track.artist.did !== auth.did || !track.record.uri.startsWith(privateSpace(auth.did) + '/' + auth.did + '/'))) return false;
    const request = ++sequence.current;
    const startedAt = Date.now();
    if (!privateTrack) console.info("[playback] load", { request, track: track.id, start });
    recordPlayback("load", { request, track: privateTrack ? "private" : track.id, start, signedIn: !!auth.did });
    accounting.stop();
    sourceEvents.current?.remove();
    player.pause();
    setQueue(tracks);
    setIndex(at);
    setReady(false);
    setResolving(true);
    setLockScreenSuspended(false);
    setStarting(null);
    setError(null);
    try {
      const playback = privateTrack ? { availability: { status: 'gated' as const, space: { record: track.record.uri }, delivery: undefined, artifact: undefined } } : await playbackFor(track.id);
      if (request !== sequence.current) return false;
      const { status: availability, space, delivery, artifact } = playback.availability;
      if (!privateTrack) console.info("[playback] availability", { request, track: track.id, availability, delivery: !!delivery, artifact: !!artifact, elapsedMs: Date.now() - startedAt });
      recordPlayback("availability", { request, availability, host: urlHost(delivery?.url), media: delivery?.media_type ?? artifact?.media_type, elapsedMs: Date.now() - startedAt });
      let url: string;
      if (availability === 'gated' && space) {
        url = await gatedAudioUrl(space.record, auth);
      } else if (availability === 'available' && delivery?.url) {
        url = delivery.url;
      } else if (availability === 'available' && artifact?.cid) {
        url = await blobUrl(track.artist.did, artifact.cid);
      } else {
        throw new Error('audio unavailable');
      }
      if (request !== sequence.current || privateTrack && (getAuth().rpc !== auth.rpc || getAuth().did !== auth.did)) {
        if (availability === 'gated') releaseGatedAudioUrl(url);
        return false;
      }
      const previousSource = objectUrl.current;
      try {
        player.replace(Platform.OS === 'web' || availability === 'gated' ? url : { uri: url, headers: { Referer: 'https://next.plyr.fm/' } });
        player.loop = !jam.active() && settings.current.repeat === 'one';
        player.volume = settings.current.volume;
      } catch (cause) {
        if (availability === 'gated') releaseGatedAudioUrl(url);
        throw cause;
      }
      objectUrl.current = availability === 'gated' ? url : null;
      if (previousSource) releaseGatedAudioUrl(previousSource);
      if (!privateTrack) accounting.begin(track.id, track.metadata.duration_seconds);
      let settled = false;
      sourceEvents.current = player.addListener('playbackStatusUpdate', (event) => {
        if (request !== sequence.current) return;
        if (event.error) {
          recordPlayback("player error", { request, error: String(event.error), elapsedMs: Date.now() - startedAt });
          setStarting((pending) => pending === request ? null : pending);
          setReady(false);
          setError(event.error);
        } else if (!settled && ((event.playing && player.currentTime > 0) || event.didJustFinish)) {
          settled = true;
          if (!privateTrack) console.info('[playback] startup settled', { request, track: track.id, position: player.currentTime, finished: event.didJustFinish });
          recordPlayback("started", { request, elapsedMs: Date.now() - startedAt });
          setStarting((pending) => pending === request ? null : pending);
        }
      });
      if (Platform.OS === 'android') {
        player.setActiveForLockScreen(true, {
          title: track.metadata.title,
          artist: track.artist.profile.display_name,
          artworkUrl: trackArtwork(track)
        }, { showSeekForward: true, showSeekBackward: true });
      }
      if (!privateTrack) console.info("[playback] source attached", { request, track: track.id, elapsedMs: Date.now() - startedAt });
      recordPlayback("source attached", { request, host: urlHost(url), elapsedMs: Date.now() - startedAt });
      warm(tracks[at + 1]);
      await waitForMedia();
      if (request !== sequence.current) return false;
      setReady(true);
      recordPlayback("media ready", { request, elapsedMs: Date.now() - startedAt });
      if (start) {
        setStarting(request);
        player.play();
        // Startup holds the loading state until the player reports progress; note when that hasn't happened.
        setTimeout(() => {
          if (request === sequence.current && !settled) recordPlayback("startup stalled", { request, playing: player.playing, position: player.currentTime, elapsedMs: Date.now() - startedAt });
        }, 10_000);
      }
      return true;
    } catch (cause) {
      if (!privateTrack) console.warn("[playback] load failed", { request, track: track.id, error: cause instanceof Error ? cause.name : "unknown", elapsedMs: Date.now() - startedAt });
      recordPlayback("load failed", { request, error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause), elapsedMs: Date.now() - startedAt });
      if (request === sequence.current) {
        setStarting(null);
        setError(cause instanceof Error ? cause.message : 'could not play audio');
      }
      return false;
    } finally {
      if (request === sequence.current) setResolving(false);
    }
  }

  useEffect(() => {
    if (starting === null) return;
    const timeout = setTimeout(() => {
      if (starting !== sequence.current) return;
      player.pause();
      setStarting(null);
      if (!privateMode.current) console.warn('[playback] startup timeout', { request: starting, track: current?.id, loaded: player.isLoaded, position: player.currentTime });
      setReady(false);
      setError('playback took too long to start');
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [current?.id, player, starting]);

  function play(track: Track, collection?: Track[], label?: string) {
    if (isPrivateTrack(track)) {
      if (!auth.did || track.artist.did !== auth.did) return;
      personal.suspend();
      jam.leave(false);
      privateOutput(true);
      const tracks = collection?.filter(item => isPrivateTrack(item) && item.artist.did === auth.did) ?? [track];
      const at = tracks.findIndex(item => item.id === track.id);
      void load(at >= 0 && playThrough ? tracks : [track], at >= 0 && playThrough ? at : 0);
      return;
    }
    privateOutput(false);
    const list = playThrough && collection?.some((item) => item.id === track.id) ? collection : [track];
    const selected = list.indexOf(track);
    const at = selected >= 0 ? selected : list.findIndex((item) => item.id === track.id);
    if (!jam.replaceQueue(list, at, true)) personal.play(track, list, list.length > 1 ? label ?? 'collection' : undefined);
  }

  async function next(explicit = true) {
    if (privateMode.current) {
      if (index + 1 < queue.length) await load(queue, index + 1);
      else if (repeat === 'all' && queue.length) await load(queue, 0);
      else player.pause();
      return;
    }
    if (jam.active()) {
      const room = jam.state();
      if (room && room.index + 1 < room.queue.length) jam.command({ action: 'selectTrack', index: room.index + 1 });
      else jam.command({ action: 'pause' });
      return;
    }
    await personal.next(explicit);
  }

  useEffect(() => {
    if (ready && status.didJustFinish && (jam.active() ? jam.jam?.canSeek : repeat !== 'one')) void next(false);
    // Audio status is the trigger. Queue edits must not replay a finish event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  function setPlaying(playing: boolean) {
    if (playing) setLockScreenSuspended(false);
    if (!privateMode.current && jam.setPlaying(playing, jam.jam?.state)) return;
    if (!playing) { if (!privateMode.current) personal.checkpoint(); player.pause(); }
    if (!privateMode.current && personal.command({ action: playing ? 'play' : 'pause' })) return;
    if (loading || !current) return;
    if (!privateMode.current && playing && !ready && personal.resume()) return;
    if (playing && (!ready || status.error || error)) void load(queue, index);
    else if (playing && !player.playing) player.play();
    else if (!playing && player.playing) player.pause();
  }

  function toggle() {
    if (!privateMode.current && jam.toggle()) return;
    setPlaying(!player.playing);
  }

  function seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const duration = !privateMode.current && !jam.active() && personal.remote ? personal.duration() : player.duration;
    const target = Math.max(0, Math.min(duration || seconds, seconds));
    if (privateMode.current) {
      if (ready) void accounting.seekTo(target).catch(() => setError('could not seek audio'));
      return;
    }
    if (jam.command({ action: 'seek', positionMs: Math.round(target * 1000) })) return;
    if (personal.remote) {
      setPendingSeek({ source: sequence.current, seconds: target });
      if (personal.ownsOutput() && ready) {
        const source = sequence.current;
        void accounting.seekTo(target).then(() => { if (source === sequence.current) personal.checkpoint(target); }).catch(() => setError('could not seek audio'));
      }
      personal.command({ action: 'seek', positionMs: Math.round(target * 1000) });
      return;
    }
    if (!ready) { personal.defer(target); return; }
    const request = ++seekRequest.current;
    const source = sequence.current;
    setPendingSeek({ source, seconds: target });
    void accounting.seekTo(target).then(() => { if (source === sequence.current && request === seekRequest.current) personal.checkpoint(target); }).catch(cause => {
      if (request !== seekRequest.current || source !== sequence.current) return;
      setPendingSeek(null);
      setError(cause instanceof Error ? cause.message : 'could not seek audio');
    });
  }

  const remoteOutput = !privatePlayback && !jam.jam && !!personal.remote && !personal.ownsOutput();
  const presentationStatus = remoteOutput ? { ...status, playing: false, isLoaded: false, isBuffering: false, didJustFinish: false,
    currentTime: personal.position(), duration: personal.duration(), error: null } : status;
  useEffect(() => { if (remoteOutput) setError(null); }, [personal.remote?.personal?.output?.clientId, current?.id]);
  const accountVisible = (previousAccount.current === null || previousAccount.current === auth.did) && (!privatePlayback || previousRpc.current === auth.rpc);
  const value: Playback = {
    jam: accountVisible ? jam.jam : undefined,
    canSeek: !jam.jam || jam.jam.canSeek && jam.jam.phase === 'connected',
    seekPreview: jam.jam ? jam.jam.pendingSeekMs === undefined ? undefined : jam.jam.pendingSeekMs / 1000 : (pendingSeek?.source === sequence.current ? pendingSeek.seconds : undefined) ?? (remoteOutput || privatePlayback ? undefined : personal.restoredPosition),
    privatePlayback,
    forgetPrivateTrack: uri => {
      if (!privateMode.current || getAuth().did !== auth.did || getAuth().rpc !== auth.rpc) return;
      const previous = privateQueue.current;
      const next = withoutPrivateTrack(previous.queue, previous.index, uri);
      if (next.currentRemoved) {
        accounting.stop(); sourceEvents.current?.remove(); sequence.current++;
        player.pause(); player.replace(null);
        if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current);
        objectUrl.current = null; setReady(false); setResolving(false); setStarting(null); setError(null); setPendingSeek(null);
      }
      privateQueue.current = { queue: next.queue, index: next.index };
      setQueue(next.queue); setIndex(next.index);
    },
    joinJam: input => { if (privateMode.current) { setError('play a public track before joining a jam.'); return; } personal.suspend(); jam.join(input); },
    leaveJam: (restore = true) => { jam.leave(false); if (restore) personal.restore(); },
    jamCommand: intent => intent.action === 'play' || intent.action === 'pause' ? jam.setPlaying(intent.action === 'play', jam.jam?.state) : jam.command(intent),
    play, queue: accountVisible ? queue : [], current: accountVisible ? current : undefined, index: accountVisible ? index : -1, loading: loading || !privatePlayback && personal.waiting, error, status: presentationStatus, tail: privatePlayback || jam.jam || !accountVisible ? undefined : personal.state.tail, outputElsewhere: !privatePlayback && !jam.jam && personal.outputElsewhere, deviceQueue: !privatePlayback && personal.deviceOnly, queueError: privatePlayback || jam.jam ? undefined : personal.queueError, keepPlaying: !privatePlayback && personal.keepPlaying, setKeepPlaying: value => { if (!privateMode.current) personal.setKeepPlaying(value); }, repeat: jam.jam ? 'off' : repeat, setRepeat: value => { if (privateMode.current) setRepeat(value); else if (!jam.active()) personal.setRepeat(value); }, toggle, setPlaying, next,
    isPlaying: () => player.playing,
    pauseLocal: () => { setLockScreenSuspended(true); personal.suspend(); player.pause(); },
    previous: () => {
      if (privateMode.current) { if (player.currentTime > 3 || index === 0) seek(0); else void load(queue, index - 1); return; }
      const room = jam.state();
      if (jam.active()) {
        if (room && player.currentTime > 3 && jam.jam?.canSeek) jam.command({ action: 'seek', positionMs: 0 });
        else if (room && room.index > 0) jam.command({ action: 'selectTrack', index: room.index - 1 });
      } else if (personal.position() > 3 || index === 0) seek(0);
      else personal.select(index - 1);
    },
    seek,
    skip: (seconds) => { const base = privateMode.current ? player.currentTime : jam.jam ? (jam.jam.pendingSeekMs === undefined ? player.currentTime : jam.jam.pendingSeekMs / 1000) : pendingSeek?.source === sequence.current ? pendingSeek.seconds : personal.position(); seek(base + seconds); },
    jump: (at) => { if (privateMode.current) { void load(queue, at); return; } if (!jam.command({ action: 'selectTrack', index: at })) personal.select(at); },
    enqueue: (track) => {
      if (isPrivateTrack(track)) { if (privateMode.current && track.artist.did === auth.did) setQueue(items => [...items, track]); else play(track); return; }
      if (privateMode.current) { toast.info('play a public track to change queues'); return; }
      toast.success(`queued ${track.metadata.title}`, 1800);
      const ref = jamTrack(track);
      if (jam.active()) { if (ref) jam.editQueue((items, at) => ({ queue: [...items, ref], index: at })); else jam.replaceQueue([...queue, track], index); }
      else personal.enqueue(track);
    },
    remove: (at) => { if (privateMode.current) { setQueue(items => editPrivateQueue(items, index, { action: 'remove', at })); return; } if (jam.editQueue((items, current) => ({ queue: at > current ? items.filter((_, position) => position !== at) : items, index: current }))) return; if (at > index) personal.remove(at); },
    move: (from, to) => {
      if (privateMode.current) { setQueue(items => editPrivateQueue(items, index, { action: 'move', from, to })); return; }
      if (jam.editQueue((items, at) => {
        if (from <= at || to <= at || from >= items.length || to >= items.length) return { queue: items, index: at };
        const reordered = items.slice(); const [track] = reordered.splice(from, 1); reordered.splice(to, 0, track);
        return { queue: reordered, index: at };
      })) return;
      personal.move(from, to);
    },
    clear: () => { if (privateMode.current) { setQueue(items => editPrivateQueue(items, index, { action: 'clear' })); return; } if (!jam.editQueue((items, at) => ({ queue: items.slice(0, at + 1), index: at }))) personal.clear(); },
    shuffle: () => {
      if (privateMode.current) { setQueue(items => editPrivateQueue(items, index, { action: 'shuffle' })); return; }
      if (jam.editQueue((items, at) => {
        const shuffled = items.slice();
        for (let i = shuffled.length - 1; i > at + 1; i--) { const j = at + 1 + Math.floor(Math.random() * (i - at)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
        return { queue: shuffled, index: at };
      })) return;
      personal.shuffle();
    }
  };
  const shown = value.current;
  const seekable = value.canSeek && !remoteOutput;
  useRemoteTrackControls(player, shown && ready && !remoteOutput && !lockScreenSuspended ? {
    metadata: { title: shown.metadata.title, artist: shown.metadata.artist_name || shown.artist.profile.display_name || shown.artist.profile.handle, artworkUrl: trackArtwork(shown) },
    previous: value.canSeek ? value.previous : undefined,
    next: value.canSeek && (value.index + 1 < value.queue.length || !value.jam && (value.keepPlaying || value.repeat === 'all')) ? () => void value.next() : undefined,
  } : null);
  useMediaSession('player', shown ? {
    title: shown.metadata.title,
    artist: shown.metadata.artist_name || shown.artist.profile.display_name || shown.artist.profile.handle,
    album: shown.metadata.album,
    artwork: trackArtwork(shown),
    playing: value.status.playing,
    position: value.seekPreview ?? value.status.currentTime,
    duration: value.status.duration || shown.metadata.duration_seconds || 0,
    play: () => value.setPlaying(true),
    pause: () => value.setPlaying(false),
    previous: value.previous,
    next: value.index + 1 < value.queue.length || value.keepPlaying || value.repeat === 'all' ? () => void value.next() : undefined,
    seek: seekable ? value.seek : undefined,
    skip: seekable ? value.skip : undefined,
  } : null);
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

interface Playback {
  forgetPrivateTrack: (uri: string) => void;
  privatePlayback: boolean;
  jam?: ActiveJam;
  canSeek: boolean;
  seekPreview?: number;
  joinJam(input: { host: string; key: string; admit: () => Promise<{ ticket: string; websocketUrl: string }> }): void;
  jamCommand(intent: JamIntent): boolean;
  leaveJam(restore?: boolean): void;
  play(track: Track, collection?: Track[], label?: string): void;
  tail?: import('./queue-state').QueueTail;
  outputElsewhere: boolean;
  deviceQueue: boolean;
  queueError?: string;
  keepPlaying: boolean;
  setKeepPlaying(value: boolean): void;
  queue: Track[];
  current?: Track;
  index: number;
  loading: boolean;
  error: string | null;
  status: ReturnType<typeof useAudioPlayerStatus>;
  repeat: 'off' | 'all' | 'one';
  setRepeat(value: Playback['repeat']): void;
  toggle(): void;
  setPlaying(playing: boolean): void;
  isPlaying(): boolean;
  pauseLocal(): void;
  next(): Promise<void>;
  previous(): void;
  seek(seconds: number): void;
  skip(seconds: number): void;
  jump(index: number): void;
  enqueue(track: Track): void;
  remove(index: number): void;
  move(from: number, to: number): void;
  clear(): void;
  shuffle(): void;
}

const PlaybackContext = createContext<Playback | null>(null);

export function PlaybackFreeze({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  const live = useContext(PlaybackContext);
  const held = useRef(live);
  if (!frozen) held.current = live;
  return <PlaybackContext.Provider value={frozen ? held.current : live}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('playback provider is missing');
  return value;
}
