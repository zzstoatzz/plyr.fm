import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { useAudioPlayerStatus } from 'expo-audio';
import type { Track } from '@plyr/next-core/api';
import { canToggleTrack } from '@plyr/next-core/track-revision';
import type { JamIntent } from '@plyr/next-core/jam-connection';
import type { RadioStation } from '@plyr/next-core/radio';
import type { ActiveJam } from '@plyr/next-core/jam-playback';

export interface Playback {
  /** Set while a radio station is the output: there is nothing to seek, skip or queue. */
  live?: { station: RadioStation };
  forgetPrivateTrack: (uri: string) => void;
  privatePlayback: boolean;
  jam?: ActiveJam;
  canSeek: boolean;
  seekPreview?: number;
  joinJam(input: { host: string; key: string; admit: () => Promise<{ ticket: string; websocketUrl: string }> }): void;
  jamCommand(intent: JamIntent): boolean;
  leaveJam(restore?: boolean): void;
  play(track: Track, collection?: Track[], label?: string): void;
  tail?: import('@plyr/next-core/queue-state').QueueTail;
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
  /** quiet: the caller already shows the track as added, so skip the toast */
  enqueue(track: Track, quiet?: boolean): void;
  /** Adds every public track, in order, under one toast that names the collection. */
  enqueueAll(tracks: Track[], label: string): void;
  /** Puts the track right after the one playing, ahead of other picks. */
  playNext(track: Track): void;
  remove(index: number): void;
  move(from: number, to: number): void;
  clear(): void;
  shuffle(): void;
}

const PlaybackContext = createContext<Playback | null>(null);
const TrackPlaybackContext = createContext<{
  current: Track | undefined;
  playing: boolean;
  inJam: boolean;
  setPlaying: Playback['setPlaying'];
} | null>(null);

export function PlaybackScope({ value, children }: { value: Playback; children: ReactNode }) {
  const { current, status: { playing } } = value;
  const inJam = !!value.jam;
  const latestSetPlaying = useRef(value.setPlaying);
  useLayoutEffect(() => { latestSetPlaying.current = value.setPlaying; }, [value.setPlaying]);
  const setPlaying = useCallback((playing: boolean) => latestSetPlaying.current(playing), []);
  const trackPlayback = useMemo(() => ({ current, playing, inJam, setPlaying }), [current, playing, inJam, setPlaying]);
  return <PlaybackContext.Provider value={value}>
    <TrackPlaybackContext.Provider value={trackPlayback}>{children}</TrackPlaybackContext.Provider>
  </PlaybackContext.Provider>;
}

export function useTrackPlaybackState() {
  const value = useContext(TrackPlaybackContext);
  if (!value) throw new Error('playback provider is missing');
  return value;
}

export function useTrackPlayback(track: Track) {
  const player = useTrackPlaybackState();
  const current = canToggleTrack(player.current, track, player.inJam);
  const playing = current && player.playing;
  return {
    current,
    playing,
    toggle: (start: () => void) => current ? player.setPlaying(!playing) : start()
  };
}

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('playback provider is missing');
  return value;
}
