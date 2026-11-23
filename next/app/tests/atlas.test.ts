import assert from 'node:assert/strict';
import test from 'node:test';
import type { AtlasData } from '@plyr/next-core/atlas/types';
import { fitView, viewScale } from '@plyr/next-core/atlas/view';
import { between, keepOnMap, panBy, pinchBy, settle, still, strayed } from '../src/atlas/camera.ts';
import { buildScene, hitTest, prepareAtlas, project } from '../src/atlas/scene.ts';

function fixture(): AtlasData {
  const points = Array.from({ length: 400 }, (_, i) => {
    const cluster = i % 4;
    const angle = i * 2.399;
    const spread = 0.05 + (i % 7) * 0.01;
    return {
      x: [-0.5, 0.5, -0.5, 0.5][cluster] + Math.cos(angle) * spread, y: [-0.5, -0.5, 0.5, 0.5][cluster] + Math.sin(angle) * spread,
      id: i + 1, title: `track ${i}`, artist: `artist ${cluster}`, handle: `a${cluster}.test`, thumb: `https://images.test/${i}.webp`,
      plays: i, likes: i % 5, clusterCoarse: cluster, clusterFine: cluster * 2 + (i % 2), core: true
    };
  });
  const coarse = [0, 1, 2, 3].map(id => ({ id, label: `region ${id}`, cx: 0, cy: 0, count: 100 }));
  const fine = Array.from({ length: 8 }, (_, id) => ({ id, label: `cluster ${id}`, cx: 0, cy: 0, count: 50, parent: id >> 1 }));
  const artists = [0, 1, 2, 3].map(i => ({ did: `did:plc:${i}`, handle: `a${i}.test`, name: `artist ${i}`, avatar: '', cx: points[i].x, cy: points[i].y, count: 100 }));
  return { points, clusters: { coarse, fine }, artists, meta: { generatedAt: '2026-11-23T00:00:00Z', nTracks: points.length } };
}

const atlas = prepareAtlas(fixture());
const size = { width: 390, height: 700 };

test('a pinch keeps the point under the fingers in place once the map is drawn again', () => {
  const view = fitView(atlas.xs, atlas.ys, size.width, size.height);
  const before = project(atlas, { ...size, view });
  const focal: [number, number] = [120, 300];
  const [dx, dy] = before.toData(...focal);
  const live = panBy(pinchBy(pinchBy(still, 1.3, ...focal, view.zoom), 1.2, ...focal, view.zoom * 1.3), 15, -10);
  const after = project(atlas, { ...size, view: settle(view, live, size.width, size.height) });
  const [sx, sy] = after.toScreen(dx, dy);
  assert.ok(Math.abs(sx - (focal[0] + 15)) < 1e-6 && Math.abs(sy - (focal[1] - 10)) < 1e-6);
  assert.ok(Math.abs(viewScale(settle(view, live, size.width, size.height), size.width, size.height) / before.scale - 1.56) < 1e-9);
});

test('an eased zoom holds its focal point at every step', () => {
  const to = pinchBy(still, 2, 100, 200, 1);
  for (const t of [0.1, 0.5, 0.9]) {
    const at = between(still, to, t);
    assert.ok(Math.abs(at.tx + at.s * 100 - 100) < 1e-9 && Math.abs(at.ty + at.s * 200 - 200) < 1e-9);
  }
});

test('the map redraws before a pan or pinch shows past what was drawn', () => {
  assert.equal(strayed(panBy(still, 40, 0), size.width, size.height, 0.25), false);
  assert.equal(strayed(panBy(still, 120, 0), size.width, size.height, 0.25), true);
  assert.equal(strayed(pinchBy(still, 0.5, 195, 350, 4), size.width, size.height, 0.25), true);
});

test('zoom stays within the map limits', () => {
  assert.equal(pinchBy(still, 1000, 0, 0, 100).s, 1.2);
});

test('the scene draws every hue once, faces with no ring, and labels that never overlap', () => {
  const view = fitView(atlas.xs, atlas.ys, size.width, size.height);
  for (const dark of [true, false]) {
    for (const zoom of [view.zoom, 3, 8, 20]) {
      const scene = buildScene(atlas, { ...size, view: { ...view, zoom }, dark, overscan: 0.25, selected: -1 });
      const steps = scene.dots.map(d => d.step);
      assert.equal(new Set(steps).size, steps.length);
      assert.equal(scene.haloWidth > 0, dark);
      if (zoom === view.zoom) assert.equal(scene.faces.length, 4, 'every artist shows a face from the opening view');
      const boxes = scene.labels.map(l => ({ x: l.x, y: l.y, hw: l.text.length * l.size * 0.28, hh: l.size / 2 }));
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) {
        assert.ok(Math.abs(a.x - b.x) >= a.hw + b.hw || Math.abs(a.y - b.y) >= a.hh + b.hh, `labels overlap at zoom ${zoom}`);
      }
    }
  }
});

test('zoomed far into a cluster, the nearest tracks turn into a bounded set of covers', () => {
  const scene = buildScene(atlas, { ...size, view: { zoom: 20, panX: 0.5, panY: 0.5 }, dark: true, overscan: 0.25, selected: 3 });
  assert.ok(scene.covers.length > 0 && scene.covers.length <= 18);
  assert.ok(scene.coverAlpha > 0 && scene.selection);
  for (const l of scene.labels) for (const c of scene.covers) {
    assert.ok(Math.abs(l.x - c.x) >= l.text.length * l.size * 0.28 + c.size / 2 || Math.abs(l.y - c.y) >= l.size / 2 + c.size / 2, `${l.text} sits on a cover`);
  }
});

test('a tap finds the artist face first, then the nearest track, then nothing', () => {
  const view = { zoom: 3, panX: 0.5, panY: 0.5 };
  const at = project(atlas, { ...size, view });
  const artist = atlas.data.artists[0];
  assert.deepEqual(hitTest(atlas, { ...size, view }, ...at.toScreen(artist.cx, artist.cy)), { artist: 0 });
  const [px, py] = at.toScreen(atlas.xs[40], atlas.ys[40]);
  const hit = hitTest(atlas, { ...size, view }, px + 2, py + 2);
  assert.ok(hit && 'point' in hit);
  assert.equal(hitTest(atlas, { ...size, view }, ...at.toScreen(3, 3)), null);
});

test('a hard flick can never throw the catalog off screen', () => {
  const view = { zoom: 2, panX: 0, panY: 0 };
  assert.equal(keepOnMap(view, atlas.bounds), view);
  const thrown = keepOnMap({ zoom: 2, panX: -40, panY: 30 }, atlas.bounds);
  assert.equal(-thrown.panX, atlas.bounds.x1);
  assert.equal(-thrown.panY, atlas.bounds.y0);
});

test('labels keep out from under the title chip and the zoom pill', () => {
  const view = fitView(atlas.xs, atlas.ys, size.width, size.height);
  const keepOut = [{ x: 0, y: 0, w: size.width, h: 340 }];
  const scene = buildScene(atlas, { ...size, view, dark: false, overscan: 0.25, selected: -1, keepOut });
  assert.ok(scene.labels.length > 0);
  for (const l of scene.labels) assert.ok(l.y - l.size / 2 >= 340, `${l.text} sits under the chip`);
});
