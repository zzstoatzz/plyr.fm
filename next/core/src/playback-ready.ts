import type { Playback } from './api.ts';

/** Waits between lookups for a track whose audio is still being copied to the streaming origin; about 36 s in all. */
export const PREPARING_DELAYS_MS = [500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000] as const;

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** Looks up playback again while a just-published track is `preparing`, and returns the first other answer. */
export async function readyPlayback(lookup: () => Promise<Playback>, { signal, onPreparing, delaysMs = PREPARING_DELAYS_MS }: {
  signal?: AbortSignal; onPreparing?: () => void; delaysMs?: readonly number[];
} = {}): Promise<Playback> {
  let playback = await lookup();
  for (const delay of delaysMs) {
    if (playback.availability.status !== 'preparing') return playback;
    onPreparing?.();
    await pause(delay, signal);
    playback = await lookup();
  }
  return playback;
}
