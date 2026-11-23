import { ArtistFaces } from './faces';
import { neighborhoods, neighborLinks, type Neighborhood } from './neighborhoods';
import type { AtlasArtist, AtlasCallbacks, AtlasData, AtlasOptions, AtlasPoint } from './types';

interface HaloSprite {
  cv: HTMLCanvasElement;
  bucket: number;
}

const HUE_STEPS = 24;
const TUNE = {
  // glows are drawn on their own layer, so overlapping ones never stack past `layer`
  regions: { spread: 1.9, minPx: 40, maxPx: 380, layer: { dark: 0.5, light: 0.38 }, outStart: 1.8, outRange: 1.0 },
  clusters: { spread: 2.4, minPx: 30, maxPx: 320, layer: { dark: 0.42, light: 0.32 }, inStart: 1.3, inRange: 1.0, outStart: 26, outRange: 10 },
  // neighbour lines stay faint: a hint of shape, not a wire diagram
  links: { alpha: { dark: 0.1, light: 0.12 }, inStart: 0.6, inRange: 0.8, maxPx: 150 },
  hueDark: { core: [0.55, 0.72], mid: [0.5, 0.52], edge: [0.45, 0.34] } as const,
  hueLight: { core: [0.55, 0.45], mid: [0.5, 0.6], edge: [0.45, 0.75] } as const,
  labels: { titles: { s: 5, l: 14 }, coarse: { s: 5, l: 10 }, fine: { s: 6, l: 16 }, artists: { s: 3, l: 8 } },
  covers: { start: 14, range: 8, budget: { s: 18, l: 36 }, maxPx: 72, minPx: 10 }
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function fadeIn(zoom: number, start: number, range: number): number {
  return clamp01((zoom - start) / range);
}
function fadeOut(zoom: number, start: number, range: number): number {
  return 1 - clamp01((zoom - start) / range);
}
function hash01(id: number): number {
  let x = (id * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return hash01(h >>> 0);
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const f = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(f(p, q, h + 1 / 3) * 255),
    Math.round(f(p, q, h) * 255),
    Math.round(f(p, q, h - 1 / 3) * 255)
  ];
}
function rgba(rgb: [number, number, number], a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface HueColors {
  core: [number, number, number];
  mid: [number, number, number];
  edge: [number, number, number];
}

export class AtlasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: AtlasCallbacks;
  private data: AtlasData | null = null;

  private dpr = 1;
  private W = 0;
  private H = 0;
  private view = { zoom: 1, panX: 0, panY: 0, minZoom: 0.5, maxZoom: 120, dirty: true };
  private frameRequested = false;
  private destroyed = false;

  // typed arrays for the hot path
  private px: Float32Array = new Float32Array(0);
  private py: Float32Array = new Float32Array(0);
  private hueStep: Uint8Array = new Uint8Array(0);
  private fineArr: Uint16Array = new Uint16Array(0);
  private popOrder: Int32Array = new Int32Array(0);
  private grid: Map<string, number[]> = new Map();
  private readonly cellSize = 0.02;

  // cached per frame
  private scale = 1;
  private cx = 0;
  private cy = 0;
  private dark = true;

  // sprite caches
  private dotSprites = new Map<number, HTMLCanvasElement>();
  private starSprites = new Map<string, HTMLCanvasElement>();
  private haloSprites = new Map<string, HTMLCanvasElement>();
  private spriteTheme = '';
  private hueCache = new Map<number, HueColors>();

  // cover art
  private coverImages = new Map<number, HTMLImageElement>();
  private coverFailed = new Set<number>();
  private coverLoading = new Set<number>();
  private coverLoadCount = 0;

  private faces = new ArtistFaces(() => this.markDirty());
  private regions: Neighborhood[] = [];
  private clusters: Neighborhood[] = [];
  private links: Uint16Array<ArrayBuffer> = new Uint16Array(0);
  private layer: HTMLCanvasElement | null = null;
  private font = 'system-ui, sans-serif';

  // interaction
  private hovered = -1;
  private hoveredArtist = -1;
  private selected = -1;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPanX = 0;
  private dragStartPanY = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMidX = 0;
  private pinchMidY = 0;
  private touches = new Map<number, { x: number; y: number }>();
  private touchMoved = false;
  private readonly isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  private readonly hitRadius = this.isTouch ? 36 : 18;

  // fly-to animation
  private animating = false;
  private animFrom = { zoom: 1, panX: 0, panY: 0 };
  private animTo = { zoom: 1, panX: 0, panY: 0 };
  private animStart = 0;
  private readonly animMs = 600;

  private resizeObserver: ResizeObserver | null = null;
  private options: AtlasOptions;
  private removeListeners: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: AtlasCallbacks, options: AtlasOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.cb = callbacks;
    this.options = options;
    this.dark = options.dark;
    this.dpr = window.devicePixelRatio || 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    if (!options.preview) this.bindInput();
    this.resize();
  }

  setData(data: AtlasData): void {
    this.data = data;
    const n = data.points.length;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.hueStep = new Uint8Array(n);
    this.fineArr = new Uint16Array(n);
    this.grid = new Map();
    const pop = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = data.points[i];
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.fineArr[i] = p.clusterFine;
      this.hueStep[i] = Math.floor(hash01(p.clusterFine) * HUE_STEPS) % HUE_STEPS;
      pop[i] = Math.log(1 + p.plays) + 2 * Math.log(1 + p.likes);
      const key = `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}`;
      let cell = this.grid.get(key);
      if (!cell) {
        cell = [];
        this.grid.set(key, cell);
      }
      cell.push(i);
    }
    this.popOrder = new Int32Array(n);
    for (let i = 0; i < n; i++) this.popOrder[i] = i;
    const order = Array.from(this.popOrder);
    order.sort((a, b) => pop[b] - pop[a]);
    this.popOrder.set(order);
    const core = data.points.map(p => p.core);
    this.regions = neighborhoods(data.clusters.coarse, this.px, this.py, data.points.map(p => p.clusterCoarse), core, this.hueStep);
    this.clusters = neighborhoods(data.clusters.fine, this.px, this.py, this.fineArr, core, this.hueStep);
    this.links = neighborLinks(this.px, this.py, this.fineArr);
    this.font = getComputedStyle(this.canvas).fontFamily || this.font;
    this.fitToData();
    this.markDirty();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    for (const off of this.removeListeners) off();
  }

  flyTo(x: number, y: number, zoom: number): void {
    this.animFrom = { zoom: this.view.zoom, panX: this.view.panX, panY: this.view.panY };
    this.animTo = { zoom, panX: -x, panY: -y };
    this.animStart = performance.now();
    this.animating = true;
    this.scheduleFrame();
  }

  // --- geometry ---

  private interacted = false;
  private insets = [0, 0];

  /** Keeps the initial fit clear of overlays along the top and bottom edges. */
  setInsets(top: number, bottom: number): void {
    this.insets = [top, bottom];
    if (this.data && !this.interacted) this.fitToData();
  }

  private fitToData(): void {
    if (!this.px.length || !this.W || !this.H) return;
    // frame the main body of the catalog: points past Tukey's fences (a far-off cluster) start off-screen
    const range = (values: Float32Array) => {
      const sorted = values.slice().sort();
      const at = (f: number) => sorted[Math.round(f * (sorted.length - 1))];
      const reach = 1.5 * (at(0.75) - at(0.25));
      const inside = sorted.filter(v => v >= at(0.25) - reach && v <= at(0.75) + reach);
      return [inside[0], inside[inside.length - 1]];
    };
    const [xMin, xMax] = range(this.px);
    const [yMin, yMax] = range(this.py);
    const spanX = Math.max(0.01, xMax - xMin);
    const spanY = Math.max(0.01, yMax - yMin);
    const base = Math.min(this.W, this.H) * 0.42;
    const [top, bottom] = this.insets.map(px => Math.min(px, this.H / 3));
    const zoom = Math.min((0.9 * this.W) / (spanX * base), (0.86 * (this.H - top - bottom)) / (spanY * base));
    this.view.zoom = Math.max(this.view.minZoom, Math.min(4, zoom));
    this.view.panX = -(xMin + xMax) / 2;
    this.view.panY = -(yMin + yMax) / 2 + (top - bottom) / 2 / (base * this.view.zoom);
  }

  // --- theme / colors ---

  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    this.markDirty();
  }

  zoomBy(factor: number): void {
    this.interacted = true;
    this.view.zoom = Math.max(this.view.minZoom, Math.min(this.view.maxZoom, this.view.zoom * factor));
    this.markDirty();
  }

  panBy(dx: number, dy: number): void {
    this.interacted = true;
    this.cacheTransform();
    this.view.panX += dx / this.scale;
    this.view.panY += dy / this.scale;
    this.markDirty();
  }

  private hueColors(step: number): HueColors {
    const themeKey = this.dark ? 1 : 0;
    const cacheKey = step * 2 + themeKey;
    let c = this.hueCache.get(cacheKey);
    if (!c) {
      const h = step / HUE_STEPS;
      const pal = this.dark ? TUNE.hueDark : TUNE.hueLight;
      c = {
        core: hslToRgb(h, pal.core[0], pal.core[1]),
        mid: hslToRgb(h, pal.mid[0], pal.mid[1]),
        edge: hslToRgb(h, pal.edge[0], pal.edge[1])
      };
      this.hueCache.set(cacheKey, c);
    }
    return c;
  }

  private themeKey(): 'dark' | 'light' {
    return this.dark ? 'dark' : 'light';
  }

  private invalidateSpritesIfThemed(): void {
    const t = this.themeKey();
    if (this.spriteTheme !== t) {
      this.spriteTheme = t;
      this.dotSprites.clear();
      this.starSprites.clear();
      this.haloSprites.clear();
      this.hueCache.clear();
    }
  }

  // --- sprites ---

  private getDotSprite(step: number): HTMLCanvasElement {
    let cv = this.dotSprites.get(step);
    if (cv) return cv;
    const c = this.hueColors(step);
    const s = Math.max(6, Math.ceil(4.6 * this.dpr));
    cv = document.createElement('canvas');
    cv.width = s;
    cv.height = s;
    const g = cv.getContext('2d')!;
    const half = s / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    const coreCol: [number, number, number] = this.dark
      ? [
          Math.round(c.core[0] + (255 - c.core[0]) * 0.38),
          Math.round(c.core[1] + (255 - c.core[1]) * 0.38),
          Math.round(c.core[2] + (255 - c.core[2]) * 0.38)
        ]
      : c.mid;
    grad.addColorStop(0, rgba(coreCol, 1));
    grad.addColorStop(0.4, rgba(c.mid, 0.5));
    grad.addColorStop(1, rgba(c.mid, 0));
    g.globalAlpha = 0.75;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(half, half, half, 0, Math.PI * 2);
    g.fill();
    this.dotSprites.set(step, cv);
    return cv;
  }

  private getStarSprite(step: number, radius: number, hover: boolean): HTMLCanvasElement {
    const r = Math.round(radius * 2) / 2;
    const key = `${step}_${r}_${hover ? 1 : 0}`;
    let cv = this.starSprites.get(key);
    if (cv) return cv;
    if (this.starSprites.size > 400) this.starSprites.clear();
    const c = this.hueColors(step);
    const rr = hover ? r * 1.35 : r;
    const size = Math.ceil(rr * 3 * this.dpr) + 2;
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d')!;
    const half = size / 2;
    const R = rr * this.dpr;
    const coreCol: [number, number, number] = this.dark
      ? [
          Math.round(c.core[0] + (255 - c.core[0]) * 0.42),
          Math.round(c.core[1] + (255 - c.core[1]) * 0.42),
          Math.round(c.core[2] + (255 - c.core[2]) * 0.42)
        ]
      : c.mid;
    const sg = g.createRadialGradient(half, half, 0, half, half, R * 1.4);
    sg.addColorStop(0, rgba(coreCol, 1));
    sg.addColorStop(0.3, rgba(c.core, 0.5));
    sg.addColorStop(1, rgba(c.core, 0));
    g.globalAlpha = hover ? 0.95 : 0.78;
    g.fillStyle = sg;
    g.beginPath();
    g.arc(half, half, R * 1.4, 0, Math.PI * 2);
    g.fill();
    this.starSprites.set(key, cv);
    return cv;
  }

  private getHaloSprite(step: number, radiusPx: number): HaloSprite {
    const buckets = [20, 50, 100, 200, 400];
    let bucket = buckets[buckets.length - 1];
    for (const b of buckets) {
      if (radiusPx <= b) {
        bucket = b;
        break;
      }
    }
    const key = `${step}_${bucket}`;
    let cv = this.haloSprites.get(key);
    if (cv) return { cv, bucket };
    const c = this.hueColors(step);
    const size = bucket * 2 + 4;
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d')!;
    const half = size / 2;
    // gaussian-style falloff — the light just dissipates, hue drifting
    // core -> mid -> edge as it fades
    const K = 3.0;
    const floor = Math.exp(-K);
    const grad = g.createRadialGradient(half, half, 0, half, half, bucket);
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      const a = (Math.exp(-K * t * t) - floor) / (1 - floor);
      const from = t < 0.5 ? c.core : c.mid;
      const to = t < 0.5 ? c.mid : c.edge;
      const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      grad.addColorStop(
        t,
        `rgba(${Math.round(from[0] + (to[0] - from[0]) * f)},${Math.round(
          from[1] + (to[1] - from[1]) * f
        )},${Math.round(from[2] + (to[2] - from[2]) * f)},${a.toFixed(4)})`
      );
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.haloSprites.set(key, cv);
    return { cv, bucket };
  }

  // --- images ---

  private loadCover(i: number): void {
    if (!this.data) return;
    if (this.coverImages.has(i) || this.coverFailed.has(i) || this.coverLoading.has(i)) return;
    if (this.coverLoadCount >= 8) return;
    const url = this.data.points[i].thumb;
    if (!url) {
      this.coverFailed.add(i);
      return;
    }
    this.coverLoading.add(i);
    this.coverLoadCount++;
    const img = new Image();
    img.onload = () => {
      this.coverImages.set(i, img);
      this.coverLoading.delete(i);
      this.coverLoadCount--;
      this.markDirty();
    };
    img.onerror = () => {
      this.coverFailed.add(i);
      this.coverLoading.delete(i);
      this.coverLoadCount--;
    };
    img.src = url;
  }

  // --- transforms ---

  private cacheTransform(): void {
    this.scale = Math.min(this.W, this.H) * 0.42 * this.view.zoom;
    this.cx = this.W / 2 + this.view.panX * this.scale;
    this.cy = this.H / 2 + this.view.panY * this.scale;
  }

  private screenToData(sx: number, sy: number): [number, number] {
    return [
      (sx - this.W / 2) / this.scale - this.view.panX,
      (sy - this.H / 2) / this.scale - this.view.panY
    ];
  }

  private findNearest(sx: number, sy: number, maxDistPx: number): number {
    if (!this.data) return -1;
    const [dx, dy] = this.screenToData(sx, sy);
    const r = maxDistPx / this.scale;
    const cs = this.cellSize;
    let best = -1;
    let bestD = r * r;
    for (let gx = Math.floor((dx - r) / cs); gx <= Math.floor((dx + r) / cs); gx++) {
      for (let gy = Math.floor((dy - r) / cs); gy <= Math.floor((dy + r) / cs); gy++) {
        const cell = this.grid.get(`${gx},${gy}`);
        if (!cell) continue;
        for (const i of cell) {
          const ddx = this.px[i] - dx;
          const ddy = this.py[i] - dy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD) {
            bestD = d2;
            best = i;
          }
        }
      }
    }
    return best;
  }

  private artistRadiusPx(a: AtlasArtist): number {
    // visible from the whole-map view; grows with sqrt(zoom) so walking in
    // makes an artist more present without ballooning past the tracks.
    // the zoom-scaled cap keeps a dominant catalog from owning the overview.
    return Math.min(
      12 + this.view.zoom * 5,
      34,
      (3.5 + Math.sqrt(a.count) * 1.2) * Math.sqrt(this.view.zoom)
    );
  }

  private findArtistAt(sx: number, sy: number): number {
    if (!this.data) return -1;
    for (let i = 0; i < this.data.artists.length; i++) {
      const a = this.data.artists[i];
      const pr = this.artistRadiusPx(a);
      if (pr < 5) continue;
      const ax = this.cx + a.cx * this.scale;
      const ay = this.cy + a.cy * this.scale;
      const dx = sx - ax;
      const dy = sy - ay;
      if (dx * dx + dy * dy <= pr * pr) return i;
    }
    return -1;
  }

  // --- frame scheduling ---

  private markDirty(): void {
    this.view.dirty = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    requestAnimationFrame(() => this.loop());
  }

  private loop(): void {
    this.frameRequested = false;
    if (this.destroyed) return;
    if (this.animating) {
      const t = Math.min(1, (performance.now() - this.animStart) / this.animMs);
      const e = easeOutCubic(t);
      this.view.zoom = this.animFrom.zoom + (this.animTo.zoom - this.animFrom.zoom) * e;
      this.view.panX = this.animFrom.panX + (this.animTo.panX - this.animFrom.panX) * e;
      this.view.panY = this.animFrom.panY + (this.animTo.panY - this.animFrom.panY) * e;
      this.view.dirty = true;
      if (t >= 1) this.animating = false;
    }
    this.render();
    if (this.animating) this.scheduleFrame();
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    this.W = rect?.width ?? window.innerWidth;
    this.H = rect?.height ?? window.innerHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.data && !this.interacted) this.fitToData();
    this.markDirty();
  }

  // --- render ---

  private render(): void {
    if (!this.data || !this.view.dirty) return;
    this.view.dirty = false;
    this.invalidateSpritesIfThemed();
    this.cacheTransform();
    const { ctx, W, H } = this;
    const zoom = this.view.zoom;
    const n = this.data.points.length;
    const small = W < 600;

    ctx.globalAlpha = 1;
    ctx.fillStyle = this.dark ? '#0a0a0a' : '#fafafa';
    ctx.fillRect(0, 0, W, H);

    const tl = this.screenToData(0, 0);
    const br = this.screenToData(W, H);
    const pad = 0.05;
    const xMin = tl[0] - pad;
    const xMax = br[0] + pad;
    const yMin = tl[1] - pad;
    const yMax = br[1] + pad;

    // --- neighborhoods: region glows hand off to cluster glows, with faint lines between neighbours ---
    const R = TUNE.regions;
    const C = TUNE.clusters;
    const regionAlpha = fadeOut(zoom, R.outStart, R.outRange);
    if (regionAlpha > 0.01) this.drawGlows(this.regions, R.spread, R.minPx, R.maxPx * (small ? 0.8 : 1), R.layer[this.themeKey()] * regionAlpha);
    const clusterAlpha = fadeIn(zoom, C.inStart, C.inRange) * fadeOut(zoom, C.outStart, C.outRange);
    if (clusterAlpha > 0.01) this.drawGlows(this.clusters, C.spread, C.minPx * Math.sqrt(Math.max(1, zoom / 2)), C.maxPx, C.layer[this.themeKey()] * clusterAlpha);
    this.drawLinks(zoom, xMin, xMax, yMin, yMax);

    // --- points ---
    const coverAlpha = fadeIn(zoom, TUNE.covers.start, TUNE.covers.range);
    const useStar = zoom >= 2;
    const pointR = Math.min(8, 1.8 + zoom * 0.22);
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      const x = this.px[i];
      const y = this.py[i];
      if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
      const sx = this.cx + x * this.scale;
      const sy = this.cy + y * this.scale;
      if (!this.dark) {
        const hot = i === this.hovered || i === this.selected;
        ctx.globalAlpha = hot ? 1 : 0.8;
        ctx.fillStyle = rgba(this.inkColor(this.hueStep[i]), 1);
        ctx.beginPath();
        ctx.arc(sx, sy, Math.min(5, 1.5 + zoom * 0.25) * (hot ? 1.6 : 1), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const spr = useStar
        ? this.getStarSprite(this.hueStep[i], pointR, i === this.hovered || i === this.selected)
        : this.getDotSprite(this.hueStep[i]);
      const w = spr.width / this.dpr;
      ctx.drawImage(spr, sx - w / 2, sy - w / 2, w, w);
    }

    // --- cover art (high zoom): tracks resolve into their actual artwork ---
    if (coverAlpha > 0.01) {
      const budget = small ? TUNE.covers.budget.s : TUNE.covers.budget.l;
      const cands: { i: number; sx: number; sy: number; d: number; size?: number }[] = [];
      const vcx = W / 2;
      const vcy = H / 2;
      for (let i = 0; i < n; i++) {
        const x = this.px[i];
        const y = this.py[i];
        if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
        const sx = this.cx + x * this.scale;
        const sy = this.cy + y * this.scale;
        const ddx = sx - vcx;
        const ddy = sy - vcy;
        cands.push({ i, sx, sy, d: ddx * ddx + ddy * ddy });
      }
      cands.sort((a, b) => a.d - b.d);
      if (cands.length > budget) cands.length = budget;
      // adaptive size: shrink to local spacing so dense clusters read as
      // distinct covers instead of an overlapping pile
      const maxPx = Math.min(TUNE.covers.maxPx, 10 + (zoom - TUNE.covers.start) * 2.2);
      for (const c of cands) {
        let best = Infinity;
        for (const o of cands) {
          if (o === c) continue;
          const dx = c.sx - o.sx;
          const dy = c.sy - o.sy;
          const dd = dx * dx + dy * dy;
          if (dd < best) best = dd;
        }
        c.size =
          best === Infinity
            ? maxPx
            : Math.max(TUNE.covers.minPx, Math.min(maxPx, Math.sqrt(best) * 0.9));
      }
      for (const c of cands) {
        this.loadCover(c.i);
        const img = this.coverImages.get(c.i);
        const size = c.size ?? maxPx;
        const half = size / 2;
        const focus = c.i === this.hovered || c.i === this.selected;
        if (img) {
          ctx.globalAlpha = coverAlpha;
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(c.sx - half, c.sy - half, size, size, Math.max(2, size * 0.08));
          ctx.clip();
          ctx.drawImage(img, c.sx - half, c.sy - half, size, size);
          ctx.restore();
          if (focus) {
            ctx.globalAlpha = coverAlpha;
            ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(c.sx - half, c.sy - half, size, size, Math.max(2, size * 0.08));
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- artist circles: always a face, or a tinted disk with an initial while
    // it loads or when the artist has none. never an empty ring.
    const artistCands: { name: string; x: number; y: number }[] = [];
    const faces: { x: number; y: number; r: number }[] = [];
    {
      for (const a of this.data.artists) {
        const pr = this.artistRadiusPx(a);
        if (pr < 7) continue;
        const ax = this.cx + a.cx * this.scale;
        const ay = this.cy + a.cy * this.scale;
        if (ax < -40 || ax > W + 40 || ay < -40 || ay > H + 40) continue;
        const face = this.faces.face(a, pr, pr * 2 * this.dpr);
        if (face) {
          ctx.globalAlpha = 1;
          ctx.drawImage(face, ax - pr, ay - pr, pr * 2, pr * 2);
        } else {
          const [r, g, b] = hslToRgb(hashText(a.did), 0.35, this.dark ? 0.28 : 0.82);
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(ax, ay, pr, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fill();
          if (pr >= 8) {
            ctx.font = `600 ${Math.round(pr * 0.9)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
            ctx.fillText((a.name || a.handle || '?').charAt(0).toLowerCase(), ax, ay + pr * 0.05);
          }
        }
        faces.push({ x: ax, y: ay, r: pr });
        if (zoom >= 2 && pr >= 9 && artistCands.length < 30) {
          artistCands.push({ name: a.handle, x: ax, y: ay + pr + 9 });
        }
      }
      ctx.globalAlpha = 1;
      this.faces.flush();
    }

    // the home preview is a still picture: dots and artists, no labels to crowd it
    if (this.options.preview) return;

    // --- label economy: one collision pass, priority order ---
    const placed: { x: number; y: number; hw: number; hh: number }[] = [];
    const PAD = small ? 2 : 4;
    const MARGIN = small ? 8 : 12;
    const canPlace = (lx: number, ly: number, tw: number, th: number): boolean => {
      const hw = tw / 2 + PAD;
      const hh = th / 2 + PAD;
      for (const p of placed) {
        if (Math.abs(lx - p.x) < hw + p.hw && Math.abs(ly - p.y) < hh + p.hh) return false;
      }
      placed.push({ x: lx, y: ly, hw, hh });
      return true;
    };
    // labels stay anchored over their subject: cull at the viewport edge
    // rather than shifting inward (a shifted label points at nothing)
    const fitsHoriz = (lx: number, halfW: number): boolean =>
      lx - halfW >= MARGIN && lx + halfW <= W - MARGIN;
    // labels step around artist faces
    for (const f of faces) placed.push({ x: f.x, y: f.y, hw: f.r + 2, hh: f.r + 2 });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawLabel = (text: string, x: number, y: number): void => {
      ctx.strokeStyle = this.dark ? 'rgba(10,10,10,0.82)' : 'rgba(250,250,250,0.9)';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };

    // neighborhood names sit above their tracks, or failing that in the middle or just below
    const nameNeighborhoods = (list: Neighborhood[], alpha: number, max: number, size: number, weight: number): void => {
      if (alpha < 0.01) return;
      ctx.font = `${weight} ${size}px ${this.font}`;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.94)' : 'rgba(20,20,20,0.9)';
      let shown = 0;
      for (const nb of list) {
        if (shown >= max) break;
        const sx = this.cx + nb.x * this.scale;
        const tw = ctx.measureText(nb.label).width;
        if (!fitsHoriz(sx, tw / 2)) continue;
        const spots = [nb.top * this.scale - size, nb.y * this.scale, nb.bottom * this.scale + size + 6];
        for (const dy of spots) {
          const ly = this.cy + dy;
          if (ly < MARGIN + size || ly > H - 40) continue;
          if (canPlace(sx, ly, tw, size)) {
            drawLabel(nb.label, sx, ly);
            shown++;
            break;
          }
        }
      }
    };
    nameNeighborhoods(this.regions, fadeOut(zoom, 1.7, 0.6), small ? TUNE.labels.coarse.s : TUNE.labels.coarse.l, small ? 12 : 14, 650);
    nameNeighborhoods(this.clusters, fadeIn(zoom, 1.7, 0.6) * fadeOut(zoom, C.outStart, C.outRange), small ? TUNE.labels.fine.s : TUNE.labels.fine.l, small ? 11 : 12.5, 550);

    const titleAlpha = fadeIn(zoom, 4.5, 1.0);
    if (titleAlpha > 0.01) {
      const fontSize = small ? 9 : 11;
      ctx.font = `500 ${fontSize + 1}px ${this.font}`;
      ctx.globalAlpha = 0.9 * titleAlpha;
      ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.88)';
      const max = small ? TUNE.labels.titles.s : TUNE.labels.titles.l;
      const truncLen = small ? 22 : 40;
      let shown = 0;
      for (let oi = 0; oi < n && shown < max; oi++) {
        const i = this.popOrder[oi];
        const x = this.px[i];
        const y = this.py[i];
        if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
        let title = this.data.points[i].title;
        if (!title) continue;
        const sx = this.cx + x * this.scale;
        const sy = this.cy + y * this.scale - (coverAlpha > 0.5 ? 30 : 10);
        if (sy < MARGIN || sy > H - 40) continue;
        if (title.length > truncLen) title = title.slice(0, truncLen - 1) + '…';
        const tw = ctx.measureText(title).width;
        if (!fitsHoriz(sx, tw / 2)) continue;
        if (canPlace(sx, sy, tw, fontSize)) {
          drawLabel(title, sx, sy);
          shown++;
        }
      }
    }

    if (artistCands.length) {
      const fontSize = small ? 8 : 10;
      ctx.font = `500 ${fontSize + 1}px ${this.font}`;
      ctx.globalAlpha = Math.min(0.8, fadeIn(zoom, 2, 1.0));
      ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
      const max = small ? TUNE.labels.artists.s : TUNE.labels.artists.l;
      let shown = 0;
      for (const cand of artistCands) {
        if (shown >= max) break;
        if (cand.y < MARGIN || cand.y > H - 40) continue;
        const name = cand.name.length > 24 ? cand.name.slice(0, 22) + '…' : cand.name;
        const tw = ctx.measureText(name).width;
        if (!fitsHoriz(cand.x, tw / 2)) continue;
        if (canPlace(cand.x, cand.y, tw, fontSize)) {
          drawLabel(name, cand.x, cand.y);
          shown++;
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  private inkColor(step: number): [number, number, number] {
    const m = this.hueColors(step).mid;
    return [Math.round(m[0] * 0.8), Math.round(m[1] * 0.8), Math.round(m[2] * 0.8)];
  }

  private drawGlows(list: Neighborhood[], spread: number, minPx: number, maxPx: number, alpha: number): void {
    const w = Math.ceil(this.W * this.dpr);
    const h = Math.ceil(this.H * this.dpr);
    if (!this.layer || this.layer.width !== w || this.layer.height !== h) {
      this.layer = document.createElement('canvas');
      this.layer.width = w;
      this.layer.height = h;
    }
    const g = this.layer.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const nb of list) {
      const r = Math.min(maxPx, Math.max(minPx, nb.r * spread * this.scale));
      const sx = this.cx + nb.x * this.scale;
      const sy = this.cy + nb.y * this.scale;
      if (sx + r < 0 || sx - r > this.W || sy + r < 0 || sy - r > this.H) continue;
      const halo = this.getHaloSprite(nb.step, r);
      const size = halo.cv.width * (r / halo.bucket);
      g.globalAlpha = 0.75 + hash01(nb.id) * 0.25;
      g.drawImage(halo.cv, sx - size / 2, sy - size / 2, size, size);
    }
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.layer, 0, 0, this.W, this.H);
    this.ctx.globalAlpha = 1;
  }

  private drawLinks(zoom: number, xMin: number, xMax: number, yMin: number, yMax: number): void {
    const T = TUNE.links;
    const alpha = clamp01((zoom - T.inStart) / T.inRange);
    if (alpha < 0.01) return;
    const S = this.scale;
    const out = (x: number, y: number) => x < xMin || x > xMax || y < yMin || y > yMax;
    const paths = new Map<number, Path2D>();
    for (let k = 0; k < this.links.length; k += 2) {
      const i = this.links[k];
      const j = this.links[k + 1];
      if (out(this.px[i], this.py[i]) && out(this.px[j], this.py[j])) continue;
      if (Math.hypot(this.px[j] - this.px[i], this.py[j] - this.py[i]) * S > T.maxPx) continue;
      let p = paths.get(this.hueStep[i]);
      if (!p) paths.set(this.hueStep[i], (p = new Path2D()));
      p.moveTo(this.cx + this.px[i] * S, this.cy + this.py[i] * S);
      p.lineTo(this.cx + this.px[j] * S, this.cy + this.py[j] * S);
    }
    const ctx = this.ctx;
    ctx.lineWidth = Math.min(1.4, 0.7 + zoom * 0.08);
    ctx.globalAlpha = T.alpha[this.themeKey()] * alpha;
    for (const [step, p] of paths) {
      ctx.strokeStyle = rgba(this.hueColors(step).mid, 1);
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
  }

  // --- input ---

  private bindInput(): void {
    const canvas = this.canvas;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.interacted = true;
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      const factor = Math.pow(0.995, dy);
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const newZoom = Math.max(this.view.minZoom, Math.min(this.view.maxZoom, this.view.zoom * factor));
      this.cacheTransform();
      const d = this.screenToData(mx, my);
      this.view.zoom = newZoom;
      this.cacheTransform();
      const d2 = this.screenToData(mx, my);
      this.view.panX += d2[0] - d[0];
      this.view.panY += d2[1] - d[1];
      this.markDirty();
    };

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartPanX = this.view.panX;
      this.dragStartPanY = this.view.panY;
    };

    const onMouseMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (this.dragging) {
        this.interacted = true;
        this.cacheTransform();
        this.view.panX = this.dragStartPanX + (e.clientX - this.dragStartX) / this.scale;
        this.view.panY = this.dragStartPanY + (e.clientY - this.dragStartY) / this.scale;
        this.markDirty();
        this.cb.onHover(null, 0, 0);
        return;
      }
      // off the map (over the nav, the header, the dock) nothing is under the pointer
      if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
        if (this.hovered >= 0 || this.hoveredArtist >= 0) {
          this.hovered = this.hoveredArtist = -1;
          this.cb.onHover(null, 0, 0);
          this.cb.onHoverArtist(null, 0, 0);
          this.markDirty();
        }
        return;
      }
      this.cacheTransform();
      const ai = this.findArtistAt(mx, my);
      if (ai >= 0) {
        if (this.hoveredArtist !== ai) {
          this.hoveredArtist = ai;
          this.hovered = -1;
          this.cb.onHover(null, 0, 0);
          this.cb.onHoverArtist(this.data!.artists[ai], mx, my);
          this.markDirty();
        }
        canvas.style.cursor = 'pointer';
        return;
      }
      if (this.hoveredArtist >= 0) {
        this.hoveredArtist = -1;
        this.cb.onHoverArtist(null, 0, 0);
      }
      const idx = this.findNearest(mx, my, this.hitRadius);
      if (idx !== this.hovered) {
        this.hovered = idx;
        this.markDirty();
        if (idx >= 0 && this.data) this.cb.onHover(this.data.points[idx], mx, my);
        else this.cb.onHover(null, 0, 0);
      }
      canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (Math.abs(e.clientX - this.dragStartX) >= 4 || Math.abs(e.clientY - this.dragStartY) >= 4)
        return;
      if (this.hoveredArtist >= 0 && this.data) {
        this.cb.onActivateArtist(this.data.artists[this.hoveredArtist]);
      } else if (this.hovered >= 0 && this.data) {
        this.cb.onActivate(this.data.points[this.hovered]);
      }
    };

    const onTouchStart = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      this.touchMoved = false;
      if (this.touches.size === 1) {
        const t = this.touches.values().next().value!;
        this.dragging = true;
        this.dragStartX = t.x;
        this.dragStartY = t.y;
        this.dragStartPanX = this.view.panX;
        this.dragStartPanY = this.view.panY;
      } else if (this.touches.size === 2) {
        this.dragging = false;
        const [a, b] = Array.from(this.touches.values());
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchStartZoom = this.view.zoom;
        this.pinchMidX = (a.x + b.x) / 2;
        this.pinchMidY = (a.y + b.y) / 2;
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      this.touchMoved = true;
      this.interacted = true;
      if (this.touches.size === 1 && this.dragging) {
        const t = this.touches.values().next().value!;
        this.cacheTransform();
        this.view.panX = this.dragStartPanX + (t.x - this.dragStartX) / this.scale;
        this.view.panY = this.dragStartPanY + (t.y - this.dragStartY) / this.scale;
        this.markDirty();
        this.selected = -1;
        this.cb.onHover(null, 0, 0);
      } else if (this.touches.size === 2) {
        const [a, b] = Array.from(this.touches.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const newZoom = Math.max(
          this.view.minZoom,
          Math.min(this.view.maxZoom, this.pinchStartZoom * (dist / this.pinchStartDist))
        );
        const rect = this.canvas.getBoundingClientRect();
        const mx = this.pinchMidX - rect.left;
        const my = this.pinchMidY - rect.top;
        this.cacheTransform();
        const d = this.screenToData(mx, my);
        this.view.zoom = newZoom;
        this.cacheTransform();
        const d2 = this.screenToData(mx, my);
        this.view.panX += d2[0] - d[0];
        this.view.panY += d2[1] - d[1];
        this.markDirty();
      }
    };

    const onTouchEnd = (e: TouchEvent): void => {
      const ended = Array.from(e.changedTouches);
      for (const t of ended) this.touches.delete(t.identifier);
      if (this.touches.size > 0) return;
      this.dragging = false;
      const first = ended[0];
      if (!first) return;
      const moved =
        this.touchMoved &&
        (Math.abs(first.clientX - this.dragStartX) >= 10 ||
          Math.abs(first.clientY - this.dragStartY) >= 10);
      if (moved || !this.data) return;
      const rect = this.canvas.getBoundingClientRect();
      const tx = first.clientX - rect.left;
      const ty = first.clientY - rect.top;
      this.cacheTransform();
      const ai = this.findArtistAt(tx, ty);
      if (ai >= 0) {
        this.cb.onActivateArtist(this.data.artists[ai]);
        return;
      }
      // first tap selects (tooltip), second tap on the same track plays
      const idx = this.findNearest(tx, ty, this.hitRadius);
      if (idx >= 0) {
        if (idx === this.selected) {
          this.cb.onActivate(this.data.points[idx]);
          this.selected = -1;
          this.cb.onHover(null, 0, 0);
        } else {
          this.selected = idx;
          this.hovered = idx;
          this.cb.onHover(this.data.points[idx], tx, ty);
          this.markDirty();
        }
      } else {
        this.selected = -1;
        this.hovered = -1;
        this.cb.onHover(null, 0, 0);
        this.markDirty();
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    this.removeListeners = [
      () => canvas.removeEventListener('wheel', onWheel),
      () => canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => canvas.removeEventListener('touchstart', onTouchStart),
      () => canvas.removeEventListener('touchmove', onTouchMove),
      () => canvas.removeEventListener('touchend', onTouchEnd)
    ];
  }
}
