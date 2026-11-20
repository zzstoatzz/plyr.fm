import type { Playback } from './api.ts';

/** How long after publishing a track's audio may still be on its way to the delivery origin. */
export const FRESH_UPLOAD_MS = 10 * 60_000;
const RETRY_MS = 2_500;
// Inside the player's 20 s loading watchdog; the copy usually lands within a few seconds.
const MAX_WAIT_MS = 15_000;

/** Audio the appview knows about but can't serve yet: a just-published track before its copy lands. */
export function awaitingDelivery(playback: Playback): boolean {
  return playback.availability.status === 'unavailable' && !!playback.availability.artifact;
}

export interface FreshPlaybackOptions {
  /** when the track was published, as the record's created_at */
  createdAt: string;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** stop waiting, e.g. when the listener has moved on */
  stale?: () => boolean;
  /** told once, when the wait starts */
  onWaiting?: () => void;
}

/**
 * Looks up playback, and for a track published in the last few minutes keeps asking while its
 * audio is still being copied for streaming, so a fresh upload plays instead of failing.
 */
export async function freshPlayback(read: (attempt: number) => Promise<Playback>, options: FreshPlaybackOptions): Promise<Playback> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const published = Date.parse(options.createdAt);
  const started = now();
  let playback = await read(0);
  if (!awaitingDelivery(playback) || !(started - published < FRESH_UPLOAD_MS)) return playback;
  options.onWaiting?.();
  for (let attempt = 1; awaitingDelivery(playback) && now() - started < MAX_WAIT_MS && !options.stale?.(); attempt++) {
    await wait(RETRY_MS);
    if (options.stale?.()) break;
    playback = await read(attempt);
  }
  return playback;
}
