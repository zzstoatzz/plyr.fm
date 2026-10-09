import type { Track } from "plyr-shared/contract";
import { credits } from "plyr-shared/format";
import { IMAGE_WIDTHS, resizedImageUrl, trackThumbnailUrl } from "plyr-shared/images";
import type { Queue } from "plyr-shared/queue";

export const UP_NEXT_ROWS = 3;
const TEXT_LIMIT = 80;

export type UpNextRow = {
  /** Queue index and track id, so a tap on a list the queue has since left behind is ignored. */
  target: string;
  title: string;
  by: string;
  /** A small remote image, or null when none is known to be small. */
  image: string | null;
};

export type UpNext = { rows: UpNextRow[]; more: number };

const BSKY_AVATAR = "https://cdn.bsky.app/img/avatar/";
const RESIZED = /^https:\/\/images(?:-stg)?\.plyr\.fm\//;

const clip = (text: string) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text);

/** A Live Activity cannot draw an image larger than itself, so only hosts that serve a small rendition are used. */
export function smallImage(track: Track): string | null {
  const url = resizedImageUrl(trackThumbnailUrl(track), IMAGE_WIDTHS.thumb);
  if (!url) return null;
  if (url.startsWith(BSKY_AVATAR)) return url.replace(BSKY_AVATAR, "https://cdn.bsky.app/img/avatar_thumbnail/");
  return RESIZED.test(url) ? url : null;
}

/** The playable tracks after the current one: the first few as rows, the rest as a count. Null when nothing follows. */
export function upNextRows(queue: Queue, canPlay: (track: Track) => boolean): UpNext | null {
  const ahead = queue.tracks.map((track, index) => ({ track, index })).filter(({ track, index }) => index > queue.index && canPlay(track));
  if (queue.index < 0 || ahead.length === 0) return null;
  const rows = ahead.slice(0, UP_NEXT_ROWS).map(({ track, index }) => ({
    target: `${index}:${track.id}`,
    title: clip(track.title),
    by: clip(credits(track)),
    image: smallImage(track),
  }));
  return { rows, more: ahead.length - rows.length };
}

/** The queue index a tapped row names, or -1 when the queue no longer has that track there. */
export function upNextTarget(queue: Queue, target: string): number {
  const [index, id] = target.split(":").map(Number);
  return index !== undefined && index > queue.index && queue.tracks[index]?.id === id ? index : -1;
}
