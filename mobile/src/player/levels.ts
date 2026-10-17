import { AppState } from "react-native";
import type { AnalyserNode, AudioContext, AudioTagHandle } from "react-native-audio-api";
import { makeMutable } from "react-native-reanimated";
import { BARS, createMeter, FFT_SIZE, REST } from "./spectrum";

const FRAME_MS = 33;

/** One height per bar of the now-playing indicator, written about 30 times a second while someone is watching. */
export const levels = Array.from({ length: BARS }, () => makeMutable(REST));

let tapped: { context: AudioContext; analyser: AnalyserNode } | null = null;
const spectrum = new Uint8Array(FFT_SIZE / 2);
const meter = createMeter();
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function analyserFor(context: AudioContext): AnalyserNode {
  if (tapped?.context === context) return tapped.analyser;
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  // the default window tops out at -30 dB, which mastered music pins flat
  analyser.maxDecibels = -8;
  analyser.minDecibels = -78;
  analyser.connect(context.destination);
  tapped = { context, analyser };
  return analyser;
}

/** Sends a loaded deck's audio through the analyser on its way out. A deck that cannot be routed keeps playing straight to the output. */
export function tap(context: AudioContext, handle: AudioTagHandle): void {
  const analyser = analyserFor(context);
  let source;
  try {
    source = context.createMediaElementSource(handle);
  } catch {
    return;
  }
  source.connect(analyser);
}

function sample() {
  if (!tapped) return;
  tapped.analyser.getByteFrequencyData(spectrum);
  meter(spectrum).forEach((level, bar) => {
    const mutable = levels[bar];
    if (mutable) mutable.value = level;
  });
}

function sync() {
  const wanted = watchers > 0 && AppState.currentState === "active";
  if (wanted && !timer) timer = setInterval(sample, FRAME_MS);
  if (!wanted && timer) {
    clearInterval(timer);
    timer = null;
  }
}

AppState.addEventListener("change", sync);

/** Keeps the levels moving until the returned function is called; with nobody watching, nothing is sampled. */
export function watch(): () => void {
  watchers++;
  sync();
  return () => {
    watchers--;
    sync();
  };
}
