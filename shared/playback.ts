import type { Track } from "./contract";

// same ladder as frontend/src/lib/skip-step.ts; playback.test.ts holds parity
export const SKIP_STEP_LADDER = [
  { underSeconds: 60, step: 5 },
  { underSeconds: 180, step: 10 },
] as const;

export const SKIP_STEP_MAX = 15;

export function skipStepSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return SKIP_STEP_MAX;
  const rung = SKIP_STEP_LADDER.find((r) => durationSeconds < r.underSeconds);
  return rung?.step ?? SKIP_STEP_MAX;
}

/** Past this, "previous" restarts the current track (PlaybackControls.svelte). */
export const RESTART_THRESHOLD_SECONDS = 1;

/** A play counts after 30 s or half the track, whichever is shorter (player.svelte.ts). */
export function playCountThreshold(durationSeconds: number): number {
  return Math.min(30, durationSeconds * 0.5);
}

/** Still on its interim lossless rendition while the MP3 is made (utils/track-audio.ts). */
export function isOptimizing(track: Track): boolean {
  return track.is_optimizing ?? (track.file_type !== "mp3" && !!track.original_file_id && !!track.original_file_type);
}

export type Playability = { playable: true } | { playable: false; reason: "gated" | "processing" };

/** Whether this client can start the track now; `decodes` says which formats its decoder handles. */
export function playability(track: Track, decodes: (format: string) => boolean): Playability {
  if (track.gated) return { playable: false, reason: "gated" };
  if (isOptimizing(track) && !decodes(track.file_type)) return { playable: false, reason: "processing" };
  return { playable: true };
}

// same wording as listeningLabel in frontend/src/lib/publishing.ts; playback.test.ts holds parity
const LISTENING_LABELS: Record<string, string> = {
  public: "anyone can listen",
  signed_in: "signed-in listeners",
  supporters: "supporters only",
  owner: "artist only",
  space: "Space members only",
};

/** Who may listen to a gated track, as the web's gated badge says it. */
export function listeningLabel(listening: string | undefined): string {
  return (listening !== undefined && LISTENING_LABELS[listening]) || "restricted listening";
}
