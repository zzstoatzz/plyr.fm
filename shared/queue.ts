import type { Track } from "./contract";
import { RESTART_THRESHOLD_SECONDS } from "./playback";

export type Queue = { readonly tracks: readonly Track[]; readonly index: number };

export const EMPTY_QUEUE: Queue = { tracks: [], index: -1 };

export function current(queue: Queue): Track | null {
  return queue.tracks[queue.index] ?? null;
}

/** Index of the next track after `from` that `canPlay` accepts, or -1 (frontend findNextPlayableIndex). */
export function nextPlayableIndex(queue: Queue, from: number, canPlay: (track: Track) => boolean): number {
  for (let i = from + 1; i < queue.tracks.length; i++) if (canPlay(queue.tracks[i])) return i;
  return -1;
}

/** Start a list at `index`, skipping forward past anything that cannot play. */
export function start(tracks: readonly Track[], index: number, canPlay: (track: Track) => boolean): Queue {
  const queue = { tracks, index: -1 };
  const first = nextPlayableIndex(queue, index - 1, canPlay);
  return first === -1 ? EMPTY_QUEUE : { tracks, index: first };
}

export function hasNext(queue: Queue, canPlay: (track: Track) => boolean): boolean {
  return nextPlayableIndex(queue, queue.index, canPlay) !== -1;
}

function previousPlayableIndex(queue: Queue, canPlay: (track: Track) => boolean): number {
  for (let i = queue.index - 1; i >= 0; i--) if (canPlay(queue.tracks[i])) return i;
  return -1;
}

/** Advance; null when nothing after the current track can play. */
export function next(queue: Queue, canPlay: (track: Track) => boolean): Queue | null {
  const index = nextPlayableIndex(queue, queue.index, canPlay);
  return index === -1 ? null : { tracks: queue.tracks, index };
}

export type PreviousStep = { kind: "restart" } | { kind: "move"; queue: Queue };

/** Restart the current track once it has played a moment, otherwise step back past what cannot play. */
export function previous(queue: Queue, currentTime: number, canPlay: (track: Track) => boolean): PreviousStep {
  const index = previousPlayableIndex(queue, canPlay);
  if (currentTime > RESTART_THRESHOLD_SECONDS || index === -1) return { kind: "restart" };
  return { kind: "move", queue: { tracks: queue.tracks, index } };
}
