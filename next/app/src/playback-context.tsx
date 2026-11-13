import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { useAudioPlayerStatus } from 'expo-audio';
import type { Track } from './api';
import type { JamIntent } from './jam-connection';
import type { RadioStation } from './radio';
import type { ActiveJam } from './use-jam-playback';

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

export const PlaybackContext = createContext<Playback | null>(null);

export function PlaybackFreeze({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  const live = useContext(PlaybackContext);
  const held = useRef(live);
  if (!frozen) held.current = live;
  return <PlaybackContext.Provider value={frozen ? held.current : live}>{children}</PlaybackContext.Provider>;
}

export function PlaybackOverride({ value, children }: { value: Playback; children: ReactNode }) {
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('playback provider is missing');
  return value;
}
