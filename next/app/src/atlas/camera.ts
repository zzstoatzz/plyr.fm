import { MAX_ZOOM, MIN_ZOOM, viewScale, type AtlasView } from '@plyr/next-core/atlas/view';

/**
 * How far a gesture has moved the drawn map since it was last drawn: a point drawn at p shows at
 * t + s·p. The map is drawn again, crisp, when the gesture settles or strays too far.
 */
export interface Live { s: number; tx: number; ty: number }

export const still: Live = { s: 1, tx: 0, ty: 0 };

/** scale by `ds` about the focal point (fx, fy), within the zoom limits */
export function pinchBy(live: Live, ds: number, fx: number, fy: number, zoom: number): Live {
  const s = Math.max(MIN_ZOOM / zoom, Math.min(MAX_ZOOM / zoom, live.s * ds));
  const k = s / live.s;
  return { s, tx: fx + k * (live.tx - fx), ty: fy + k * (live.ty - fy) };
}

export function panBy(live: Live, dx: number, dy: number): Live {
  return { s: live.s, tx: live.tx + dx, ty: live.ty + dy };
}

/** the view the moved map now shows, to draw it again at rest */
export function settle(view: AtlasView, live: Live, width: number, height: number): AtlasView {
  if (live === still) return view;
  const scale = viewScale(view, width, height);
  const cx = live.tx + live.s * (width / 2 + view.panX * scale);
  const cy = live.ty + live.s * (height / 2 + view.panY * scale);
  const next = scale * live.s;
  return { zoom: view.zoom * live.s, panX: (cx - width / 2) / next, panY: (cy - height / 2) / next };
}

/** true once the moved drawing would show an edge past its overscan, or has been scaled enough to blur */
export function strayed(live: Live, width: number, height: number, overscan: number): boolean {
  if (live.s < 0.6 || live.s > 1.6) return true;
  const ox = width * overscan * 0.9;
  const oy = height * overscan * 0.9;
  return -live.tx / live.s < -ox || (width - live.tx) / live.s > width + ox
    || -live.ty / live.s < -oy || (height - live.ty) / live.s > height + oy;
}

/** the camera between `from` and `to`, eased, for a double tap or the zoom buttons */
export function between(from: Live, to: Live, t: number): Live {
  const e = 1 - (1 - t) ** 3;
  return { s: from.s + (to.s - from.s) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
}

/** the view, moved so the middle of the screen stays over the catalog; the same object when it already does */
export function keepOnMap(view: AtlasView, bounds: { x0: number; x1: number; y0: number; y1: number }): AtlasView {
  const panX = Math.max(-bounds.x1, Math.min(-bounds.x0, view.panX));
  const panY = Math.max(-bounds.y1, Math.min(-bounds.y0, view.panY));
  return panX === view.panX && panY === view.panY ? view : { ...view, panX, panY };
}
