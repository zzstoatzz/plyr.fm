import type { AtlasArtist } from './types.ts';

/** where the map is looking: `zoom` over a base of 42% of the short side, centred on (-panX, -panY) */
export interface AtlasView { zoom: number; panX: number; panY: number }

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 120;

export const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

/** pixels per data unit */
export function viewScale(view: AtlasView, width: number, height: number): number {
  return Math.min(width, height) * 0.42 * view.zoom;
}

/** Tukey's fences on one axis: the main body of the catalog, leaving a far-off cluster outside */
function bodyRange(values: ArrayLike<number>): [number, number] {
  const sorted = Float64Array.from(values).sort();
  const at = (f: number) => sorted[Math.round(f * (sorted.length - 1))];
  const reach = 1.5 * (at(0.75) - at(0.25));
  const inside = sorted.filter(v => v >= at(0.25) - reach && v <= at(0.75) + reach);
  return [inside[0], inside[inside.length - 1]];
}

/** The opening view: frames the main clusters, clear of overlays `top` and `bottom` pixels deep. */
export function fitView(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, height: number, top = 0, bottom = 0): AtlasView {
  const [xMin, xMax] = bodyRange(xs);
  const [yMin, yMax] = bodyRange(ys);
  const spanX = Math.max(0.01, xMax - xMin);
  const spanY = Math.max(0.01, yMax - yMin);
  const base = Math.min(width, height) * 0.42;
  const [t, b] = [top, bottom].map(px => Math.min(px, height / 3));
  const zoom = Math.max(MIN_ZOOM, Math.min(4, Math.min((0.9 * width) / (spanX * base), (0.86 * (height - t - b)) / (spanY * base))));
  return { zoom, panX: -(xMin + xMax) / 2, panY: -(yMin + yMax) / 2 + (t - b) / 2 / (base * zoom) };
}

/**
 * An artist's face, in pixels: visible from the whole-map view and growing with sqrt(zoom), so walking in
 * makes an artist more present without ballooning past the tracks. The zoom-scaled cap keeps a dominant
 * catalog from owning the overview.
 */
export function artistRadius(artist: Pick<AtlasArtist, 'count'>, zoom: number): number {
  return Math.min(12 + zoom * 5, 34, (3.5 + Math.sqrt(artist.count) * 1.2) * Math.sqrt(zoom));
}

/** how much a track stands out, for which titles get a label first */
export function popularity(point: { plays: number; likes: number }): number {
  return Math.log(1 + point.plays) + 2 * Math.log(1 + point.likes);
}

/** a bucketed index of points, for finding the one under a finger */
export class PointGrid {
  private cells = new Map<string, number[]>();
  private readonly xs: ArrayLike<number>;
  private readonly ys: ArrayLike<number>;
  private readonly size: number;

  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>, size = 0.02) {
    this.xs = xs;
    this.ys = ys;
    this.size = size;
    for (let i = 0; i < xs.length; i++) {
      const key = `${Math.floor(xs[i] / size)},${Math.floor(ys[i] / size)}`;
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push(i);
    }
  }

  /** the closest point to (x, y) within `r` data units, or -1 */
  nearest(x: number, y: number, r: number): number {
    const cs = this.size;
    let best = -1;
    let bestD = r * r;
    for (let gx = Math.floor((x - r) / cs); gx <= Math.floor((x + r) / cs); gx++) {
      for (let gy = Math.floor((y - r) / cs); gy <= Math.floor((y + r) / cs); gy++) {
        for (const i of this.cells.get(`${gx},${gy}`) ?? []) {
          const dx = this.xs[i] - x;
          const dy = this.ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = i;
          }
        }
      }
    }
    return best;
  }
}
