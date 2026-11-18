export interface Rect { x: number; y: number; width: number; height: number }
export interface Flight { from: Rect; to: Rect }
export interface Range { inputRange: number[]; outputRange: number[] }

/** Flight progress samples, open (1) to docked (0); a horizontal path is interpolated between them. */
export const flightSteps = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0];

function settle(progress: number) {
  const k = Math.min(1, progress / 0.4);
  return k * k * (3 - 2 * k);
}

/** The art leaves the dock toward the screen's center line before it grows into place. */
export function artLeft(art: Flight, width: number, progress: number) {
  const small = art.from.height / art.to.height;
  const centered = (width - art.to.width * (small + (1 - small) * progress)) / 2;
  return art.from.x + (centered - art.from.x) * settle(progress);
}

/** The title keeps its open-state offset from the art while both travel. */
export function titleLeft(title: Flight, art: Flight, width: number, progress: number) {
  return title.from.x + (artLeft(art, width, progress) + title.to.x - art.to.x - title.from.x) * settle(progress);
}

/**
 * Interpolation ranges over the sheet's translation (0 open, `rest` docked) that draw `to`
 * at its own rect when open and exactly over `from` when docked. `left` is the x at each of `flightSteps`.
 */
export function flightRanges(flight: Flight, rest: number, left?: readonly number[]) {
  const { from, to } = flight;
  const at = (open: number, docked: number): Range => ({ inputRange: [0, rest], outputRange: [open, docked] });
  return {
    translateX: left ? { inputRange: flightSteps.map(progress => rest * (1 - progress)), outputRange: left.map(x => x - to.x) } : at(0, from.x - to.x),
    translateY: at(0, from.y - to.y),
    scale: at(1, from.height / to.height),
  };
}
