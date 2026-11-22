// Pull-to-refresh on the home feed: plyr.fm's loading wave sits in the gap and tunes in as the
// pull grows. Shared by web (touch events) and iOS (UIRefreshControl), which pass their own
// threshold: iOS must match where UIRefreshControl fires, web picks its own.

export const BARS = 5;
/** The wave's resting shape, the same as the loading wave's. */
export const WAVE_REST = [0.4, 0.72, 1, 0.72, 0.4] as const;
const FLOOR = 0.12;
/** Falling back under this share of the threshold disarms, so jitter at the line can't fire twice. */
const REARM = 0.8;

export type PullState = { step: number; armed: boolean };
export type PullEvent = 'none' | 'tick' | 'arm' | 'disarm';
export const restingPull: PullState = { step: 0, armed: false };

/**
 * One finger movement while dragging, `pull` in points past the resting top. Each bar lighting up
 * is a tick, on the way out only. Crossing the threshold arms once.
 */
export function pullMove(state: PullState, pull: number, threshold: number): { state: PullState; event: PullEvent } {
  const progress = Math.max(0, pull) / threshold;
  if (state.armed) {
    return progress < REARM ? { state: { step: litBars(progress), armed: false }, event: 'disarm' } : { state, event: 'none' };
  }
  if (progress >= 1) return { state: { step: BARS, armed: true }, event: 'arm' };
  const step = litBars(progress);
  if (step === state.step) return { state, event: 'none' };
  return { state: { step, armed: false }, event: step > state.step ? 'tick' : 'none' };
}

function litBars(progress: number) {
  return Math.min(BARS - 1, Math.floor(progress * BARS));
}

export type WavePhase = 'idle' | 'refreshing' | 'settled';

/** Where each bar is headed, as a share of full height. */
export function waveTarget(index: number, phase: WavePhase, progress: number, armed: boolean, seconds: number) {
  if (phase === 'refreshing') return 0.32 + 0.68 * (0.5 + 0.5 * Math.sin(2 * Math.PI * seconds / 1.15 - index * 0.5 - Math.PI / 2));
  if (phase === 'settled') return FLOOR;
  if (armed) return WAVE_REST[index] * 1.12;
  return FLOOR + (WAVE_REST[index] - FLOOR) * barLight(index, progress);
}

/** How lit one bar is, 0 to 1, as the pull grows. */
export function barLight(index: number, progress: number) {
  return Math.min(1, Math.max(0, progress * BARS - index));
}

export type Bar = { height: number; velocity: number };

/** One spring step in fixed sub-steps, so a dropped frame cannot make a bar explode. */
export function barStep(bar: Bar, target: number, dt: number): Bar {
  let { height, velocity } = bar;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    velocity += (-190 * (height - target) - 11 * velocity) * h;
    height += velocity * h;
  }
  return { height: Math.max(0.08, Math.min(1.35, height)), velocity };
}

/**
 * The upward kick a change in pull speed (points per second) gives a bar, like a level meter:
 * a steady pull barely moves the wave, a flick makes it jump. Bars get slightly different
 * weights so the jump reads as a wave and not a block.
 */
export function pullKick(index: number, speedChange: number) {
  const weight = 0.7 + 0.25 * ((index * 7) % 3);
  const kick = Math.min(40, Math.abs(speedChange) * 0.0016 * weight);
  return speedChange > 0 ? kick : kick * 0.5;
}

/** The kick every bar gets as the pull crosses the line. */
export function armKick(index: number) {
  return 9 + (index % 2) * 3;
}

/** How many tracks in `next` came in above everything the feed already had. */
export function newAtTop(before: readonly { id: string }[], next: readonly { id: string }[]) {
  if (!before.length) return 0;
  const known = new Set(before.map(track => track.id));
  let count = 0;
  for (const track of next) {
    if (known.has(track.id)) break;
    count++;
  }
  return count;
}

export type RefreshResult = { ok: true; fresh: number } | { ok: false };

export function refreshMessage(result: RefreshResult) {
  if (!result.ok) return 'could not refresh';
  if (!result.fresh) return 'up to date';
  return result.fresh === 1 ? '1 new track' : `${result.fresh} new tracks`;
}
