import type { AtlasCluster } from './types';

/** a cluster as the map draws it: where its tracks sit, how far they spread, and the hue most of them share */
export interface Neighborhood { id: number; label: string; count: number; x: number; y: number; r: number; top: number; bottom: number; step: number }

export function neighborhoods(clusters: AtlasCluster[], xs: Float32Array, ys: Float32Array, ids: ArrayLike<number>, core: boolean[], steps: Uint8Array): Neighborhood[] {
  const members = new Map<number, number[]>();
  for (let i = 0; i < ids.length; i++) {
    let m = members.get(ids[i]);
    if (!m) members.set(ids[i], (m = []));
    m.push(i);
  }
  const out: Neighborhood[] = [];
  for (const cl of clusters) {
    const all = members.get(cl.id);
    if (!all?.length) continue;
    let x = 0;
    let y = 0;
    for (const i of all) {
      x += xs[i];
      y += ys[i];
    }
    x /= all.length;
    y /= all.length;
    // the nearest 90% of core tracks, so one stray track doesn't stretch the shape
    const near = all
      .map(i => ({ i, d: (xs[i] - x) ** 2 + (ys[i] - y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(3, Math.ceil(all.length * 0.9)))
      .map(e => e.i)
      .filter(i => core[i] || all.length < 8);
    const use = near.length >= 3 ? near : all;
    let ss = 0;
    let top = Infinity;
    let bottom = -Infinity;
    const tally = new Map<number, number>();
    for (const i of use) {
      ss += (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
      top = Math.min(top, ys[i]);
      bottom = Math.max(bottom, ys[i]);
    }
    for (const i of all) tally.set(steps[i], (tally.get(steps[i]) ?? 0) + 1);
    const step = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ id: cl.id, label: cl.label, count: all.length, x, y, r: Math.sqrt(ss / use.length), top, bottom, step });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** pairs of tracks joined on the map: each to its nearest few neighbours in the same cluster */
export function neighborLinks(xs: Float32Array, ys: Float32Array, ids: ArrayLike<number>, radius = 0.06, per = 3): Uint32Array<ArrayBuffer> {
  const grid = new Map<string, number[]>();
  const cellOf = (i: number) => [Math.floor(xs[i] / radius), Math.floor(ys[i] / radius)];
  for (let i = 0; i < xs.length; i++) {
    const key = cellOf(i).join();
    let c = grid.get(key);
    if (!c) grid.set(key, (c = []));
    c.push(i);
  }
  const pairs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const [gx, gy] = cellOf(i);
    const near: { j: number; d: number }[] = [];
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gy - 1; b <= gy + 1; b++) {
        for (const j of grid.get(`${a},${b}`) ?? []) {
          if (j <= i || ids[j] !== ids[i]) continue;
          const d = (xs[j] - xs[i]) ** 2 + (ys[j] - ys[i]) ** 2;
          if (d < radius * radius && d > 1e-8) near.push({ j, d });
        }
      }
    }
    near.sort((p, q) => p.d - q.d);
    for (const { j } of near.slice(0, per)) pairs.push(i, j);
  }
  return Uint32Array.from(pairs);
}
