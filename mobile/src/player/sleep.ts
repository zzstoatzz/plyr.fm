export const SLEEP_MINUTES = [15, 30, 45, 60] as const;
export const SLEEP_EXTENSION_MINUTES = 10;

/** How long the music takes to fade out before a timed sleep pauses it. */
export const FADE_MS = 10_000;

/** A sleep timer: until a moment, or until whatever is playing ends. Times are epoch milliseconds. */
export type Sleep = { kind: "at"; startedAt: number; endsAt: number } | { kind: "track" };

export function sleepIn(minutes: number, now: number): Sleep {
  return { kind: "at", startedAt: now, endsAt: now + minutes * 60_000 };
}

/** More time on a running timer; a timer waiting for the track to end becomes a timed one. */
export function extended(sleep: Sleep, minutes: number, now: number): Sleep {
  return sleep.kind === "at" ? { ...sleep, endsAt: sleep.endsAt + minutes * 60_000 } : sleepIn(minutes, now);
}

/** Playback volume under a timer: full until the fade begins, then down to silence at the end. */
export function sleepVolume(sleep: Sleep, now: number): number {
  if (sleep.kind === "track") return 1;
  return Math.min(1, Math.max(0, (sleep.endsAt - now) / FADE_MS));
}

/** "12 min left", rounded up so the last minute never reads as zero. */
export function sleepRemaining(sleep: Sleep, now: number): string {
  if (sleep.kind === "track") return "until this track ends";
  return `${Math.max(1, Math.ceil((sleep.endsAt - now) / 60_000))} min left`;
}

export const sleepChoice = (minutes: number) => (minutes === 60 ? "1 hour" : `${minutes} minutes`);
