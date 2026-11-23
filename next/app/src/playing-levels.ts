import { useEffect, useSyncExternalStore } from 'react';
import { Animated } from 'react-native';
import { createWaveEasing, levelsAt, waveBars, waveFloor, type TrackWaveform } from '@plyr/next-core/track-waveform';
import { api } from './api-client';

// One loop reads the playing track's levels at the play position into
// `waveHeights` for every bars icon; without levels, icons keep their canned motion.

export const waveHeights = Array.from({ length: waveBars }, () => new Animated.Value(waveFloor));

const waveforms = new Map<string, Promise<TrackWaveform | null>>();
const easing = createWaveEasing();
const targets = new Array<number>(waveBars).fill(0);
const listeners = new Set<() => void>();
let source = { uri: undefined as string | undefined, position: 0, at: 0, playing: false };
let waveform: TrackWaveform | null = null;
let followed: string | undefined;
let live = false;
let users = 0;
let frame = 0;
let last = 0;

function load(uri: string) {
  let pending = waveforms.get(uri);
  if (!pending) {
    pending = api.trackWaveform(uri).catch(() => {
      waveforms.delete(uri);
      return null;
    });
    waveforms.set(uri, pending);
  }
  return pending;
}

function setLive(value: boolean) {
  if (live === value) return;
  live = value;
  listeners.forEach(listener => listener());
}

function tick(now: number) {
  frame = 0;
  const playing = source.playing && !!waveform && waveform.uri === source.uri;
  if (playing) {
    // status arrives four times a second; between updates the clock runs on
    const position = source.position + Math.min(1, (now - source.at) / 1000);
    const heights = easing.step(levelsAt(waveform!, position, targets), last ? (now - last) / 1000 : 0);
    heights.forEach((height, bar) => waveHeights[bar].setValue(height));
  }
  setLive(playing);
  last = now;
  schedule();
}

function schedule() {
  if (!frame && users > 0) frame = requestAnimationFrame(tick);
}

/** The playback provider reports the track on air and where it is, each status update. */
export function feedPlayingLevels(uri: string | undefined, position: number, playing: boolean) {
  source = { uri, position, at: performance.now(), playing };
  if (uri === followed) return;
  followed = uri;
  waveform = null;
  easing.reset();
  if (uri) void load(uri).then(found => { if (followed === uri) waveform = found; });
}

/** Whether the bars follow the audio now; keeps the loop running while `follows`. */
export function usePlayingLevels(follows: boolean): boolean {
  useEffect(() => {
    if (!follows) return;
    users++;
    schedule();
    return () => {
      if (--users > 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      setLive(false);
    };
  }, [follows]);
  const following = useSyncExternalStore(subscribe, () => live);
  return follows && following;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
