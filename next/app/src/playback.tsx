import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { api, type Track } from './api';
import { useAuth } from './auth';
import { blobUrl } from './identity';
import { gatedAudioUrl, releaseGatedAudioUrl } from './gated-audio';

export function PlaybackProvider({ children, playThrough, keepPlaying, volume }: {
  children: ReactNode; playThrough: boolean; keepPlaying: boolean; volume: number;
}) {
  const auth = useAuth();
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [resolving, setResolving] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);
  const loading = resolving || starting !== null;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const sequence = useRef(0);
  const jamTrack = useRef<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const current = queue[index];

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    }
    return () => {
      sequence.current++;
      if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current);
    };
  }, []);
  const previousAccount = useRef(auth.did);
  useEffect(() => {
    if (previousAccount.current === auth.did) return;
    previousAccount.current = auth.did;
    sequence.current++;
    player.pause();
    player.replace(null);
    if (objectUrl.current) releaseGatedAudioUrl(objectUrl.current);
    objectUrl.current = null;
    setQueue([]);
    setIndex(-1);
    setReady(false);
    setResolving(false);
    setStarting(null);
    setError(null);
  }, [auth.did, player]);
  useEffect(() => { player.volume = volume; }, [player, volume]);
  useEffect(() => { player.loop = repeat === 'one'; }, [player, repeat]);

  async function load(tracks: Track[], at: number, start = true) {
    const track = tracks[at];
    if (!track) return false;
    const request = ++sequence.current;
    player.pause();
    setQueue(tracks);
    setIndex(at);
    setReady(false);
    setResolving(true);
    setStarting(null);
    setError(null);
    try {
      const playback = await api.playback(track.id);
      const { status: availability, space, delivery, artifact } = playback.availability;
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
      if (request !== sequence.current) {
        if (availability === 'gated') releaseGatedAudioUrl(url);
        return false;
      }
      const previousSource = objectUrl.current;
      try {
        player.replace(Platform.OS === 'web' || availability === 'gated' ? url : { uri: url, headers: { Referer: 'https://next.plyr.fm/' } });
      } catch (cause) {
        if (availability === 'gated') releaseGatedAudioUrl(url);
        throw cause;
      }
      objectUrl.current = availability === 'gated' ? url : null;
      if (previousSource) releaseGatedAudioUrl(previousSource);
      if (Platform.OS !== 'web') {
        player.setActiveForLockScreen(true, {
          title: track.metadata.title,
          artist: track.artist.profile.display_name,
          artworkUrl: track.media.artwork?.url
        }, { showSeekForward: true, showSeekBackward: true });
      }
      setReady(true);
      if (start) {
        setStarting(request);
        player.play();
      }
      return true;
    } catch (cause) {
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
    if ((status.playing && status.isLoaded && player.playing) || status.error) {
      setStarting(null);
      return;
    }
    const timeout = setTimeout(() => {
      if (starting !== sequence.current) return;
      player.pause();
      setStarting(null);
      setError('Playback took too long to start');
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [player, starting, status.error, status.isLoaded, status.playing]);

  function play(track: Track, collection?: Track[]) {
    const list = playThrough && collection?.some((item) => item.id === track.id) ? collection : [track];
    void load(list, list.findIndex((item) => item.id === track.id));
  }

  async function next() {
    if (index + 1 < queue.length) { await load(queue, index + 1); return; }
    if (repeat === 'all' && queue.length) { await load(queue, 0); return; }
    if (!keepPlaying) return;
    const request = sequence.current;
    try {
      const seen = new Set(queue.map((track) => track.id));
      const result = await api.tracks({ limit: 30 });
      if (request !== sequence.current) return;
      const more = result.data.filter((track) => !seen.has(track.id));
      if (more.length) await load([...queue, ...more], index + 1);
    } catch {
      if (request === sequence.current) setError('could not load more tracks');
    }
  }

  useEffect(() => {
    if (!jamTrack.current && ready && status.didJustFinish && repeat !== 'one') void next();
    // Audio status is the trigger. Queue edits must not replay a finish event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  function toggle() {
    if (loading || !current) return;
    if (!ready) void load(queue, index);
    else if (status.playing) player.pause();
    else player.play();
  }

  const value: Playback = {
    async syncJam(track, position, playing) {
      const key = `${track.id}/${track.record.cid}`;
      if (jamTrack.current !== key || current?.id !== track.id || !ready) {
        jamTrack.current = key;
        if (!await load([track], 0, false) || jamTrack.current !== key) return;
      }
      if (Math.abs(player.currentTime - position) > 0.6) await player.seekTo(position);
      if (playing && !player.playing) player.play();
      else if (!playing && player.playing) player.pause();
    },
    leaveJam() {
      if (!jamTrack.current) return;
      jamTrack.current = null;
      sequence.current++;
      setStarting(null);
      setResolving(false);
      player.pause();
    },
    play, queue, current, index, loading, error, status, repeat, setRepeat, toggle, next,
    previous: () => { if (status.currentTime > 3 || index === 0) void player.seekTo(0); else void load(queue, index - 1); },
    seek: (seconds) => { if (ready) void player.seekTo(seconds); },
    jump: (at) => { void load(queue, at); },
    enqueue: (track) => { if (current) setQueue((items) => [...items, track]); else play(track); },
    remove: (at) => { if (at > index) setQueue((items) => items.filter((_, position) => position !== at)); },
    move: (from, to) => setQueue((items) => {
      if (from <= index || to <= index || from >= items.length || to >= items.length || from === to) return items;
      const reordered = items.slice();
      const [track] = reordered.splice(from, 1);
      reordered.splice(to, 0, track);
      return reordered;
    }),
    clear: () => setQueue((items) => items.slice(0, index + 1)),
    shuffle: () => setQueue((items) => {
      const shuffled = items.slice();
      for (let i = shuffled.length - 1; i > index + 1; i--) {
        const j = index + 1 + Math.floor(Math.random() * (i - index));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    })
  };
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

interface Playback {
  syncJam(track: Track, position: number, playing: boolean): Promise<void>;
  leaveJam(): void;
  play(track: Track, collection?: Track[]): void;
  queue: Track[];
  current?: Track;
  index: number;
  loading: boolean;
  error: string | null;
  status: ReturnType<typeof useAudioPlayerStatus>;
  repeat: 'off' | 'all' | 'one';
  setRepeat(value: Playback['repeat']): void;
  toggle(): void;
  next(): Promise<void>;
  previous(): void;
  seek(seconds: number): void;
  jump(index: number): void;
  enqueue(track: Track): void;
  remove(index: number): void;
  move(from: number, to: number): void;
  clear(): void;
  shuffle(): void;
}

const PlaybackContext = createContext<Playback | null>(null);

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('playback provider is missing');
  return value;
}
