/** Where timed comments sit along a scrubber. Faces closer than their own width share a pile that shows a few of them and a count. */
export const FACE = 18;
export const STEP = 10;
export const SHOWN = 3;
export const COUNT_WIDTH = 26;
const GAP = 3;

export interface Pile<T> { left: number; anchor: number; width: number; items: T[] }

export function pileWidth(count: number) {
  return FACE + (Math.min(count, SHOWN) - 1) * STEP + (count > SHOWN ? COUNT_WIDTH : 0);
}

/** `inset` is how far the slider's track starts from each edge (half its thumb), so a face's stem lands on the time it names. */
export function trackX(ms: number, durationMs: number, width: number, inset: number) {
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, ms / durationMs)) : 0;
  return inset + fraction * Math.max(0, width - 2 * inset);
}

export function pileFaces<T>(items: readonly T[], at: (item: T) => number, durationMs: number, width: number, inset: number): Pile<T>[] {
  const piles: Pile<T>[] = [];
  for (const item of [...items].sort((a, b) => at(a) - at(b))) {
    const x = trackX(at(item), durationMs, width, inset);
    const last = piles.at(-1);
    if (last && x - FACE / 2 < last.left + last.width + GAP) {
      last.items.push(item);
      last.width = pileWidth(last.items.length);
      continue;
    }
    piles.push({ left: x - FACE / 2, anchor: x, width: FACE, items: [item] });
  }
  for (const pile of piles) pile.left = Math.max(0, Math.min(pile.left, width - pile.width));
  return piles;
}

/** The comment playback is passing: the latest one at or before the position, for `windowMs` after its time. */
export function passingComment<T>(items: readonly T[], at: (item: T) => number, positionMs: number, windowMs = 4000): T | undefined {
  let found: T | undefined;
  for (const item of items) {
    const time = at(item);
    if (time <= positionMs && positionMs - time < windowMs && (found === undefined || time >= at(found))) found = item;
  }
  return found;
}

/** Keeps a popover of `size` inside `[0, width]`, starting a little left of its anchor. */
export function clampLeft(anchor: number, size: number, width: number, lead = 20) {
  return Math.max(0, Math.min(anchor - lead, width - size));
}
