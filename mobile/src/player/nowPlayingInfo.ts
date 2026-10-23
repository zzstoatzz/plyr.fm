import type { Track } from "plyr-shared/contract";
import { credits } from "plyr-shared/format";
import { IMAGE_WIDTHS, resizedImageUrl, trackCoverUrl } from "plyr-shared/images";

type Playback = { status: "idle" | "loading" | "playing" | "paused" | "buffering" | "failed"; position: number; duration: number };

/**
 * What the lock screen, Control Center and the Dynamic Island are told about a track.
 * The system keeps any field an update leaves out, so every field is always sent:
 * a track without an album must not inherit the last one's, and an unknown duration is 0.
 * The clock only runs while audio is actually moving, so a stalled track does not drift ahead.
 */
export function nowPlayingInfo(track: Track, { status, position, duration }: Playback) {
  const active = status === "playing" || status === "buffering";
  return {
    title: track.title,
    artist: credits(track),
    album: track.album?.title ?? "",
    artwork: resizedImageUrl(trackCoverUrl(track), IMAGE_WIDTHS.hero) ?? undefined,
    duration: duration > 0 ? duration : 0,
    elapsedTime: position,
    speed: status === "playing" ? 1 : 0,
    state: active ? ("playing" as const) : ("paused" as const),
  };
}
