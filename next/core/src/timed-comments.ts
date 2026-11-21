import type { TrackComment } from './api.ts';

/** How long a comment stays up over the cover after playback reaches it. */
export const SHOW_MS = 5000;

export type Moment = 'heard' | 'now' | 'ahead';

const byTime = <T>(items: readonly T[], at: (item: T) => number) => [...items].sort((a, b) => at(a) - at(b));

/** The comments playback reached in the last `showMs`, oldest first, at most `most` of them. */
export function reachedComments<T>(items: readonly T[], at: (item: T) => number, positionMs: number, showMs = SHOW_MS, most = 2): T[] {
  return byTime(items.filter(item => at(item) <= positionMs && positionMs - at(item) < showMs), at).slice(-most);
}

/** Every comment in time order, marked against playback, and the row the synced view keeps in sight:
 *  the comment just reached, else the next one coming, else the last. */
export function commentTimeline<T>(items: readonly T[], at: (item: T) => number, positionMs: number, showMs = SHOW_MS) {
  const rows = byTime(items, at).map(item => {
    const time = at(item);
    const moment: Moment = time > positionMs ? 'ahead' : positionMs - time < showMs ? 'now' : 'heard';
    return { item, moment };
  });
  const now = rows.findLastIndex(row => row.moment === 'now');
  const next = rows.findIndex(row => row.moment === 'ahead');
  return { rows, focus: now >= 0 ? now : next >= 0 ? next : rows.length - 1 };
}

/** A comment of nothing but a few emoji, which reads best large. */
export function emojiOnly(text: string) {
  const trimmed = text.trim();
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) && [...trimmed].length <= 12
    && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|\s)+$/u.test(trimmed);
}

/** The name a comment goes by: the author's display name, else their handle. */
export const commentAuthor = (comment: TrackComment) => comment.author.display_name || comment.author.handle || 'someone';
