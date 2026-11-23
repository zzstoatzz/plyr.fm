import { neighborhoods, neighborLinks, type Neighborhood } from '@plyr/next-core/atlas/neighborhoods';
import { clamp01, fadeIn, fadeOut, hash01, hueStepOf, TUNE } from '@plyr/next-core/atlas/palette';
import type { AtlasData } from '@plyr/next-core/atlas/types';
import { artistRadius, PointGrid, popularity, viewScale, type AtlasView } from '@plyr/next-core/atlas/view';

/** what the map derives from the data once, before any frame */
export interface PreparedAtlas {
  data: AtlasData;
  xs: Float32Array;
  ys: Float32Array;
  steps: Uint8Array;
  byPopularity: Int32Array;
  regions: Neighborhood[];
  clusters: Neighborhood[];
  links: Uint32Array;
  grid: PointGrid;
  /** the catalog's extent, which the middle of the screen stays over */
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

export function prepareAtlas(data: AtlasData): PreparedAtlas {
  const n = data.points.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const steps = new Uint8Array(n);
  const fine = new Uint16Array(n);
  data.points.forEach((p, i) => {
    xs[i] = p.x;
    ys[i] = p.y;
    fine[i] = p.clusterFine;
    steps[i] = hueStepOf(p.clusterFine);
  });
  const pop = data.points.map(popularity);
  const byPopularity = Int32Array.from(data.points.keys()).sort((a, b) => pop[b] - pop[a]);
  const core = data.points.map(p => p.core);
  return {
    data, xs, ys, steps, byPopularity,
    regions: neighborhoods(data.clusters.coarse, xs, ys, data.points.map(p => p.clusterCoarse), core, steps),
    clusters: neighborhoods(data.clusters.fine, xs, ys, fine, core, steps),
    links: neighborLinks(xs, ys, fine),
    grid: new PointGrid(xs, ys),
    bounds: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  };
}

/** One frame of the map, in screen pixels. Shapes reach `overscan` of a screen past each edge so a pan has something to reveal. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Frame { width: number; height: number; view: AtlasView; dark: boolean; overscan: number; selected: number; keepOut?: Rect[] }

export interface Glow { key: number; x: number; y: number; r: number; step: number; opacity: number }
export interface Label { key: string; text: string; x: number; y: number; size: number; weight: '500' | '600' | '700'; alpha: number }
export interface Scene {
  frame: Frame;
  regionGlows: Glow[];
  regionAlpha: number;
  clusterGlows: Glow[];
  clusterAlpha: number;
  /** neighbour lines, one path per hue */
  links: { step: number; d: string }[];
  linkAlpha: number;
  linkWidth: number;
  /** each hue's dots as one path, stroked `dotWidth` wide; dark mode strokes it again `haloWidth` wide and faint underneath */
  dots: { step: number; d: string }[];
  dotWidth: number;
  haloWidth: number;
  covers: { i: number; x: number; y: number; size: number }[];
  coverAlpha: number;
  faces: { i: number; x: number; y: number; r: number }[];
  labels: Label[];
  /** where the selected track sits, for its ring */
  selection?: { x: number; y: number };
}

const fixed = (v: number) => Math.round(v * 10) / 10;
/** a dot as a near-zero stroke: drawn with a round cap as wide as the dot, so one short path serves every size */
const dot = (x: number, y: number) => `M${fixed(x)} ${fixed(y)}h.01`;

/** rough rendered width, for keeping labels apart; the app has no text measuring off screen */
const textWidth = (text: string, size: number) => text.length * size * 0.56;

export function project(atlas: PreparedAtlas, frame: Pick<Frame, 'width' | 'height' | 'view'>) {
  const scale = viewScale(frame.view, frame.width, frame.height);
  const cx = frame.width / 2 + frame.view.panX * scale;
  const cy = frame.height / 2 + frame.view.panY * scale;
  return {
    scale, cx, cy,
    toScreen: (x: number, y: number): [number, number] => [cx + x * scale, cy + y * scale],
    toData: (sx: number, sy: number): [number, number] => [(sx - cx) / scale, (sy - cy) / scale]
  };
}

/** what a tap at (sx, sy) lands on: an artist's face first, then the nearest track within reach */
export function hitTest(atlas: PreparedAtlas, frame: Pick<Frame, 'width' | 'height' | 'view'>, sx: number, sy: number): { artist: number } | { point: number } | null {
  const { toScreen, toData, scale } = project(atlas, frame);
  const artists = atlas.data.artists;
  // faces draw in array order, so the last one is on top
  for (let i = artists.length - 1; i >= 0; i--) {
    const r = artistRadius(artists[i], frame.view.zoom);
    if (r < 7) continue;
    const [ax, ay] = toScreen(artists[i].cx, artists[i].cy);
    if ((sx - ax) ** 2 + (sy - ay) ** 2 <= r * r) return { artist: i };
  }
  const [x, y] = toData(sx, sy);
  const point = atlas.grid.nearest(x, y, 36 / scale);
  return point >= 0 ? { point } : null;
}

export function buildScene(atlas: PreparedAtlas, frame: Frame): Scene {
  const { width: W, height: H, view: { zoom }, dark } = frame;
  const { scale, cx, cy } = project(atlas, frame);
  const ox = W * frame.overscan;
  const oy = H * frame.overscan;
  const inBounds = (sx: number, sy: number, pad: number) => sx >= -ox - pad && sx <= W + ox + pad && sy >= -oy - pad && sy <= H + oy + pad;
  const { xs, ys, steps } = atlas;
  const n = xs.length;
  const theme = dark ? 'dark' : 'light';

  const glows = (list: Neighborhood[], spread: number, minPx: number, maxPx: number) => list.flatMap(nb => {
    const r = Math.min(maxPx, Math.max(minPx, nb.r * spread * scale));
    const x = cx + nb.x * scale;
    const y = cy + nb.y * scale;
    return inBounds(x, y, r) ? [{ key: nb.id, x, y, r, step: nb.step, opacity: 0.75 + hash01(nb.id) * 0.25 }] : [];
  });
  const R = TUNE.regions;
  const C = TUNE.clusters;
  const regionAlpha = R.layer[theme] * fadeOut(zoom, R.outStart, R.outRange);
  const clusterAlpha = C.layer[theme] * fadeIn(zoom, C.inStart, C.inRange) * fadeOut(zoom, C.outStart, C.outRange);

  const L = TUNE.links;
  const linkAlpha = L.alpha[theme] * clamp01((zoom - L.inStart) / L.inRange);
  const linkPaths = new Map<number, string[]>();
  if (linkAlpha > 0.01) {
    for (let k = 0; k < atlas.links.length; k += 2) {
      const i = atlas.links[k];
      const j = atlas.links[k + 1];
      const [ax, ay, bx, by] = [cx + xs[i] * scale, cy + ys[i] * scale, cx + xs[j] * scale, cy + ys[j] * scale];
      if (!inBounds(ax, ay, 0) && !inBounds(bx, by, 0)) continue;
      if (Math.hypot(bx - ax, by - ay) > L.maxPx) continue;
      let parts = linkPaths.get(steps[i]);
      if (!parts) linkPaths.set(steps[i], (parts = []));
      parts.push(`M${fixed(ax)} ${fixed(ay)}L${fixed(bx)} ${fixed(by)}`);
    }
  }

  // dark mode: a bright centre in a soft halo, like the web's star sprites; light mode: solid ink dots
  const starR = zoom >= 2 ? Math.min(8, 1.8 + zoom * 0.22) : 2.3;
  const inkR = Math.min(5, 1.5 + zoom * 0.25);
  const dotParts = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const sx = cx + xs[i] * scale;
    const sy = cy + ys[i] * scale;
    if (!inBounds(sx, sy, 8)) continue;
    let parts = dotParts.get(steps[i]);
    if (!parts) dotParts.set(steps[i], (parts = []));
    parts.push(dot(sx, sy));
  }

  // covers: the tracks nearest the middle resolve into their artwork, sized to the local spacing
  const coverAlpha = fadeIn(zoom, TUNE.covers.start, TUNE.covers.range);
  const covers: Scene['covers'] = [];
  if (coverAlpha > 0.01) {
    const cands: { i: number; x: number; y: number; d: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = cx + xs[i] * scale;
      const y = cy + ys[i] * scale;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      cands.push({ i, x, y, d: (x - W / 2) ** 2 + (y - H / 2) ** 2 });
    }
    cands.sort((a, b) => a.d - b.d);
    cands.length = Math.min(cands.length, TUNE.covers.budget.s);
    const maxPx = Math.min(TUNE.covers.maxPx, 10 + (zoom - TUNE.covers.start) * 2.2);
    for (const c of cands) {
      let best = Infinity;
      for (const o of cands) if (o !== c) best = Math.min(best, (c.x - o.x) ** 2 + (c.y - o.y) ** 2);
      covers.push({ i: c.i, x: c.x, y: c.y, size: best === Infinity ? maxPx : Math.max(TUNE.covers.minPx, Math.min(maxPx, Math.sqrt(best) * 0.9)) });
    }
  }

  // faces: every artist big enough to read, never an empty ring
  const faces: Scene['faces'] = [];
  const artistNames: { name: string; x: number; y: number }[] = [];
  atlas.data.artists.forEach((a, i) => {
    const r = artistRadius(a, zoom);
    if (r < 7) return;
    const x = cx + a.cx * scale;
    const y = cy + a.cy * scale;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
    faces.push({ i, x, y, r });
    if (zoom >= 2 && r >= 9 && artistNames.length < 30) artistNames.push({ name: a.handle, x, y: y + r + 9 });
  });

  return {
    frame,
    regionGlows: regionAlpha > 0.01 ? glows(atlas.regions, R.spread, R.minPx, R.maxPx * 0.8) : [],
    regionAlpha,
    clusterGlows: clusterAlpha > 0.01 ? glows(atlas.clusters, C.spread, C.minPx * Math.sqrt(Math.max(1, zoom / 2)), C.maxPx) : [],
    clusterAlpha,
    links: [...linkPaths].map(([step, parts]) => ({ step, d: parts.join('') })),
    linkAlpha,
    linkWidth: Math.min(1.4, 0.7 + zoom * 0.08),
    dots: [...dotParts].map(([step, parts]) => ({ step, d: parts.join('') })),
    dotWidth: dark ? starR * 0.9 : inkR * 2,
    haloWidth: dark ? starR * 2.4 : 0,
    covers,
    coverAlpha,
    faces,
    labels: placeLabels(atlas, frame, { scale, cx, cy }, faces, covers, artistNames, coverAlpha),
    selection: frame.selected >= 0 ? { x: cx + xs[frame.selected] * scale, y: cy + ys[frame.selected] * scale } : undefined
  };
}

/** the label economy: one collision pass in priority order, labels stepping around faces and covers and never pushed off their subject */
function placeLabels(atlas: PreparedAtlas, frame: Frame, at: { scale: number; cx: number; cy: number }, faces: Scene['faces'], covers: Scene['covers'],
  artistNames: { name: string; x: number; y: number }[], coverAlpha: number): Label[] {
  const { width: W, height: H, view: { zoom } } = frame;
  const { scale, cx, cy } = at;
  const PAD = 2;
  const MARGIN = 8;
  const placed = [...faces.map(f => ({ x: f.x, y: f.y, hw: f.r + 2, hh: f.r + 2 })),
    ...covers.map(c => ({ x: c.x, y: c.y, hw: c.size / 2 + 2, hh: c.size / 2 + 2 })),
    ...(frame.keepOut ?? []).map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, hw: r.w / 2, hh: r.h / 2 }))];
  const labels: Label[] = [];
  const fits = (x: number, halfW: number) => x - halfW >= MARGIN && x + halfW <= W - MARGIN;
  const place = (x: number, y: number, w: number, h: number) => {
    const hw = w / 2 + PAD;
    const hh = h / 2 + PAD;
    if (placed.some(p => Math.abs(x - p.x) < hw + p.hw && Math.abs(y - p.y) < hh + p.hh)) return false;
    placed.push({ x, y, hw, hh });
    return true;
  };

  const name = (list: Neighborhood[], alpha: number, max: number, size: number, weight: Label['weight'], kind: string) => {
    if (alpha < 0.01) return;
    let shown = 0;
    for (const nb of list) {
      if (shown >= max) break;
      const x = cx + nb.x * scale;
      const w = textWidth(nb.label, size);
      if (!fits(x, w / 2)) continue;
      for (const dy of [nb.top * scale - size, nb.y * scale, nb.bottom * scale + size + 6]) {
        const y = cy + dy;
        if (y < MARGIN + size || y > H - 40) continue;
        if (place(x, y, w, size)) {
          labels.push({ key: `${kind}${nb.id}`, text: nb.label, x, y, size, weight, alpha });
          shown++;
          break;
        }
      }
    }
  };
  const C = TUNE.clusters;
  name(atlas.regions, fadeOut(zoom, 1.7, 0.6), TUNE.labels.coarse.s, 13, '700', 'r');
  name(atlas.clusters, fadeIn(zoom, 1.7, 0.6) * fadeOut(zoom, C.outStart, C.outRange), TUNE.labels.fine.s, 12, '600', 'c');

  const coverSize = new Map(covers.map(c => [c.i, c.size]));
  const titleAlpha = 0.9 * fadeIn(zoom, 4.5, 1);
  if (titleAlpha > 0.01) {
    let shown = 0;
    for (let k = 0; k < atlas.byPopularity.length && shown < TUNE.labels.titles.s; k++) {
      const i = atlas.byPopularity[k];
      const x = cx + atlas.xs[i] * scale;
      const y = cy + atlas.ys[i] * scale - (coverAlpha > 0.5 ? (coverSize.get(i) ?? 0) / 2 + 9 : 10);
      if (x < 0 || x > W || y < MARGIN || y > H - 40) continue;
      let text = atlas.data.points[i].title;
      if (!text) continue;
      if (text.length > 22) text = text.slice(0, 21) + '…';
      const w = textWidth(text, 11);
      if (fits(x, w / 2) && place(x, y, w, 11)) {
        labels.push({ key: `t${i}`, text, x, y, size: 11, weight: '600', alpha: titleAlpha });
        shown++;
      }
    }
  }

  const artistAlpha = Math.min(0.8, fadeIn(zoom, 2, 1));
  let shown = 0;
  for (const a of artistNames) {
    if (shown >= TUNE.labels.artists.s) break;
    if (a.y < MARGIN || a.y > H - 40) continue;
    const text = a.name.length > 24 ? a.name.slice(0, 22) + '…' : a.name;
    const w = textWidth(text, 10);
    if (fits(a.x, w / 2) && place(a.x, a.y, w, 10)) {
      labels.push({ key: `a${a.name}`, text, x: a.x, y: a.y, size: 10, weight: '500', alpha: artistAlpha });
      shown++;
    }
  }
  return labels;
}
