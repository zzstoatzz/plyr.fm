/**
 * canvas renderer for the /atlas page — a 2D semantic map of the catalog.
 *
 * adapted from pub-search's atlas (pub-search.waow.tech/atlas): sprite-stamped
 * points over a spatial grid, cluster "lantern" nebulae, and one shared
 * label-collision economy placed in priority order. plyr-specific choices:
 * every point takes its fine cluster's hue (there is no platform dimension
 * here), and at high zoom tracks resolve into their actual cover art, drawn
 * plain — artwork is the artist's presentation, never decorated.
 */

export interface AtlasPoint {
	x: number;
	y: number;
	id: number;
	title: string;
	artist: string;
	handle: string;
	thumb: string;
	plays: number;
	likes: number;
	clusterCoarse: number;
	clusterFine: number;
	core: boolean;
}

export interface AtlasCluster {
	id: number;
	label: string;
	cx: number;
	cy: number;
	count: number;
	parent?: number;
	// computed client-side
	radius?: number;
	lantern?: { x: number; y: number; r: number } | null;
}

export interface AtlasArtist {
	did: string;
	handle: string;
	name: string;
	avatar: string;
	cx: number;
	cy: number;
	count: number;
}

export interface AtlasData {
	points: AtlasPoint[];
	clusters: { coarse: AtlasCluster[]; fine: AtlasCluster[] };
	artists: AtlasArtist[];
	meta: { generatedAt: string; nTracks: number };
}

export interface AtlasCallbacks {
	onHover: (point: AtlasPoint | null, sx: number, sy: number) => void;
	onHoverArtist: (artist: AtlasArtist | null, sx: number, sy: number) => void;
	onActivate: (point: AtlasPoint) => void;
	onActivateArtist: (artist: AtlasArtist) => void;
}

const HUE_STEPS = 24;
const TUNE = {
	nebula: {
		alpha: 0.2,
		spread: 3.0,
		minHaloPx: 40,
		growRefZoom: 2,
		maxHaloPx: 340,
		varBase: 0.7,
		varRange: 0.3,
		inStart: 1.7,
		inRange: 1.2,
		outStart: 26,
		outRange: 10
	},
	coarse: { alphaDark: 0.13, alphaLight: 0.1, outStart: 1.8, outRange: 1.0 },
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

	// artist avatars
	private avatarImages = new Map<string, HTMLImageElement>();
	private avatarFailed = new Set<string>();

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
	private readonly isTouch =
		typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
	private readonly hitRadius = this.isTouch ? 36 : 18;

	// fly-to animation
	private animating = false;
	private animFrom = { zoom: 1, panX: 0, panY: 0 };
	private animTo = { zoom: 1, panX: 0, panY: 0 };
	private animStart = 0;
	private readonly animMs = 600;

	private themeObserver: MutationObserver | null = null;
	private resizeHandler = () => this.resize();
	private removeListeners: (() => void)[] = [];

	constructor(canvas: HTMLCanvasElement, callbacks: AtlasCallbacks) {
		this.canvas = canvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('canvas 2d context unavailable');
		this.ctx = ctx;
		this.cb = callbacks;
		this.dpr = window.devicePixelRatio || 1;
		this.readTheme();
		this.themeObserver = new MutationObserver(() => {
			this.readTheme();
			this.markDirty();
		});
		this.themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		window.addEventListener('resize', this.resizeHandler);
		this.bindInput();
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
		this.computeClusterGeometry(data.clusters.coarse, 'clusterCoarse');
		this.computeClusterGeometry(data.clusters.fine, 'clusterFine');
		this.fitToData();
		this.markDirty();
	}

	destroy(): void {
		this.destroyed = true;
		this.themeObserver?.disconnect();
		window.removeEventListener('resize', this.resizeHandler);
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

	private fitToData(): void {
		if (!this.px.length) return;
		let xMin = Infinity;
		let xMax = -Infinity;
		let yMin = Infinity;
		let yMax = -Infinity;
		for (let i = 0; i < this.px.length; i++) {
			if (this.px[i] < xMin) xMin = this.px[i];
			if (this.px[i] > xMax) xMax = this.px[i];
			if (this.py[i] < yMin) yMin = this.py[i];
			if (this.py[i] > yMax) yMax = this.py[i];
		}
		const spanX = Math.max(0.01, xMax - xMin);
		const spanY = Math.max(0.01, yMax - yMin);
		const base = Math.min(this.W, this.H) * 0.42;
		const zoom = Math.min((0.9 * this.W) / (spanX * base), (0.86 * this.H) / (spanY * base));
		this.view.zoom = Math.max(this.view.minZoom, Math.min(4, zoom));
		this.view.panX = -(xMin + xMax) / 2;
		this.view.panY = -(yMin + yMax) / 2;
	}

	private computeClusterGeometry(
		clusters: AtlasCluster[],
		key: 'clusterCoarse' | 'clusterFine'
	): void {
		if (!this.data) return;
		const byId = new Map<number, AtlasCluster>();
		const members = new Map<number, number[]>();
		for (const cl of clusters) {
			byId.set(cl.id, cl);
			members.set(cl.id, []);
		}
		for (let i = 0; i < this.data.points.length; i++) {
			members.get(this.data.points[i][key])?.push(i);
		}
		for (const cl of clusters) {
			const idx = members.get(cl.id) ?? [];
			if (!idx.length) {
				cl.radius = 0.03;
				cl.lantern = null;
				continue;
			}
			let distSum = 0;
			for (const i of idx) {
				distSum += Math.hypot(this.px[i] - cl.cx, this.py[i] - cl.cy);
			}
			cl.radius = (distSum / idx.length) * 2 || 0.03;
			// lantern: weighted center of members within the trimmed radius,
			// sized by RMS spread — the light sits where the tracks are
			const kept = idx.filter(
				(i) => Math.hypot(this.px[i] - cl.cx, this.py[i] - cl.cy) <= (cl.radius ?? 0.03)
			);
			const use = kept.length ? kept : idx;
			let mx = 0;
			let my = 0;
			for (const i of use) {
				mx += this.px[i];
				my += this.py[i];
			}
			mx /= use.length;
			my /= use.length;
			let sum2 = 0;
			for (const i of use) {
				const dx = this.px[i] - mx;
				const dy = this.py[i] - my;
				sum2 += dx * dx + dy * dy;
			}
			cl.lantern = { x: mx, y: my, r: Math.max(0.008, Math.sqrt(sum2 / use.length)) };
		}
	}

	// --- theme / colors ---

	private readTheme(): void {
		this.dark = !document.documentElement.classList.contains('theme-light');
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

	private themeKey(): string {
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
		const s = Math.max(4, Math.ceil(2.8 * this.dpr));
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
		g.globalAlpha = 0.6;
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

	private getHaloSprite(clusterId: number, radiusPx: number): { cv: HTMLCanvasElement; bucket: number } {
		const buckets = [20, 50, 100, 200, 400];
		let bucket = buckets[buckets.length - 1];
		for (const b of buckets) {
			if (radiusPx <= b) {
				bucket = b;
				break;
			}
		}
		const step = Math.floor(hash01(clusterId) * HUE_STEPS) % HUE_STEPS;
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

	private loadAvatar(a: AtlasArtist): void {
		if (this.avatarImages.has(a.did) || this.avatarFailed.has(a.did) || !a.avatar) return;
		const img = new Image();
		img.onload = () => {
			this.avatarImages.set(a.did, img);
			this.markDirty();
		};
		img.onerror = () => this.avatarFailed.add(a.did);
		img.src = a.avatar;
		// mark as pending so we don't create duplicate Image objects
		this.avatarImages.set(a.did, img);
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
		return Math.min(26, Math.sqrt(a.count) * this.view.zoom * 0.9);
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

		// --- coarse region nebulae (zoomed out) ---
		const coarseAlphaNow =
			(this.dark ? TUNE.coarse.alphaDark : TUNE.coarse.alphaLight) *
			fadeOut(zoom, TUNE.coarse.outStart, TUNE.coarse.outRange);
		if (coarseAlphaNow > 0.01) {
			for (const cl of this.data.clusters.coarse) {
				const r = (cl.radius ?? 0.05) * this.scale;
				if (r < 2) continue;
				const sx = this.cx + cl.cx * this.scale;
				const sy = this.cy + cl.cy * this.scale;
				if (sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) continue;
				const halo = this.getHaloSprite(cl.id + 1000, r);
				const drawSize = halo.cv.width * (r / halo.bucket) * (small ? 0.7 : 1);
				ctx.globalAlpha = coarseAlphaNow;
				ctx.drawImage(halo.cv, sx - drawSize / 2, sy - drawSize / 2, drawSize, drawSize);
			}
			ctx.globalAlpha = 1;
		}

		// --- fine cluster lanterns (zoomed in) ---
		const neb = TUNE.nebula;
		const nebAlpha = fadeIn(zoom, neb.inStart, neb.inRange) * fadeOut(zoom, neb.outStart, neb.outRange);
		if (nebAlpha > 0.01) {
			for (const cl of this.data.clusters.fine) {
				const L = cl.lantern;
				if (!L) continue;
				const rFloor = neb.minHaloPx * Math.sqrt(Math.max(1, zoom / neb.growRefZoom));
				const rPx =
					Math.min(neb.maxHaloPx, Math.max(rFloor, L.r * neb.spread * this.scale)) *
					(small ? 0.85 : 1);
				const sx = this.cx + L.x * this.scale;
				const sy = this.cy + L.y * this.scale;
				if (sx + rPx < 0 || sx - rPx > W || sy + rPx < 0 || sy - rPx > H) continue;
				const halo = this.getHaloSprite(cl.id, rPx);
				const drawSize = halo.cv.width * (rPx / halo.bucket);
				const v = neb.varBase + hash01(cl.id) * neb.varRange;
				ctx.globalAlpha = neb.alpha * v * nebAlpha;
				ctx.drawImage(halo.cv, sx - drawSize / 2, sy - drawSize / 2, drawSize, drawSize);
			}
			ctx.globalAlpha = 1;
		}

		// --- points ---
		const coverAlpha = fadeIn(zoom, TUNE.covers.start, TUNE.covers.range);
		const useStar = zoom >= 2;
		const pointR = Math.min(6, 1.0 + zoom * 0.18);
		ctx.globalAlpha = 1;
		for (let i = 0; i < n; i++) {
			const x = this.px[i];
			const y = this.py[i];
			if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
			const sx = this.cx + x * this.scale;
			const sy = this.cy + y * this.scale;
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

		// --- artist circles ---
		const artistCands: { name: string; x: number; y: number }[] = [];
		if (zoom >= 2.5) {
			let avatarBudget = small ? 8 : 20;
			for (const a of this.data.artists) {
				const pr = this.artistRadiusPx(a);
				if (pr < 5) continue;
				const ax = this.cx + a.cx * this.scale;
				const ay = this.cy + a.cy * this.scale;
				if (ax < -40 || ax > W + 40 || ay < -40 || ay > H + 40) continue;
				const wantAvatar = pr >= 10 && avatarBudget > 0;
				if (wantAvatar) {
					this.loadAvatar(a);
					avatarBudget--;
				}
				const img = wantAvatar ? this.avatarImages.get(a.did) : undefined;
				const loaded = img && img.complete && img.naturalWidth > 0;
				if (loaded) {
					ctx.save();
					ctx.globalAlpha = 0.9;
					ctx.beginPath();
					ctx.arc(ax, ay, pr, 0, Math.PI * 2);
					ctx.clip();
					ctx.drawImage(img, ax - pr, ay - pr, pr * 2, pr * 2);
					ctx.restore();
				} else {
					ctx.globalAlpha = 0.55;
					ctx.beginPath();
					ctx.arc(ax, ay, pr, 0, Math.PI * 2);
					ctx.fillStyle = this.dark ? '#1a1a1a' : '#e8e8e8';
					ctx.fill();
					if (pr >= 12) {
						ctx.font = `bold ${Math.max(8, Math.round(pr * 0.8))}px monospace`;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
						ctx.globalAlpha = 0.9;
						ctx.fillText((a.name || '?').charAt(0).toLowerCase(), ax, ay);
					}
				}
				ctx.globalAlpha = 0.25 + Math.min(0.35, pr / 40);
				ctx.beginPath();
				ctx.arc(ax, ay, pr, 0, Math.PI * 2);
				ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
				ctx.lineWidth = 1.5;
				ctx.stroke();
				if (zoom >= 3.5 && pr >= 9 && artistCands.length < 30) {
					artistCands.push({ name: a.handle, x: ax, y: ay + pr + 9 });
				}
			}
			ctx.globalAlpha = 1;
		}

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

		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const drawLabel = (text: string, x: number, y: number): void => {
			ctx.strokeStyle = this.dark ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.88)';
			ctx.lineWidth = 4;
			ctx.lineJoin = 'round';
			ctx.strokeText(text, x, y);
			ctx.fillText(text, x, y);
		};

		const coarseLabelAlpha = fadeOut(zoom, 1.7, 0.6);
		if (coarseLabelAlpha > 0.01) {
			const fontSize = small ? 10 : 13;
			ctx.font = `${fontSize}px monospace`;
			ctx.globalAlpha = 0.95 * coarseLabelAlpha;
			ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.88)';
			const max = small ? TUNE.labels.coarse.s : TUNE.labels.coarse.l;
			let shown = 0;
			const sorted = [...this.data.clusters.coarse].sort((a, b) => b.count - a.count);
			for (const cl of sorted) {
				if (shown >= max) break;
				const sx = this.cx + cl.cx * this.scale;
				const sy = this.cy + cl.cy * this.scale - Math.sqrt(cl.count) * 1.5;
				if (sy < MARGIN || sy > H - 40) continue;
				const tw = ctx.measureText(cl.label).width;
				if (!fitsHoriz(sx, tw / 2)) continue;
				if (canPlace(sx, sy, tw, fontSize)) {
					drawLabel(cl.label, sx, sy);
					shown++;
				}
			}
		}

		const fineLabelAlpha = fadeIn(zoom, 1.7, 0.6) * fadeOut(zoom, neb.outStart, neb.outRange);
		if (fineLabelAlpha > 0.01) {
			const fontSize = small ? 10 : 12;
			ctx.font = `bold ${fontSize}px monospace`;
			ctx.globalAlpha = 0.95 * fineLabelAlpha;
			ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.88)';
			const max = small ? TUNE.labels.fine.s : TUNE.labels.fine.l;
			let shown = 0;
			const sorted = [...this.data.clusters.fine].sort((a, b) => b.count - a.count);
			for (const cl of sorted) {
				if (shown >= max) break;
				if (cl.cx < xMin || cl.cx > xMax || cl.cy < yMin || cl.cy > yMax) continue;
				const sx = this.cx + cl.cx * this.scale;
				const sy = this.cy + cl.cy * this.scale - 14;
				if (sy < MARGIN || sy > H - 40) continue;
				const tw = ctx.measureText(cl.label).width;
				if (!fitsHoriz(sx, tw / 2)) continue;
				if (canPlace(sx, sy, tw, fontSize)) {
					drawLabel(cl.label, sx, sy);
					shown++;
				}
			}
		}

		const titleAlpha = fadeIn(zoom, 4.5, 1.0);
		if (titleAlpha > 0.01) {
			const fontSize = small ? 9 : 11;
			ctx.font = `${fontSize}px monospace`;
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
			ctx.font = `${fontSize}px monospace`;
			ctx.globalAlpha = Math.min(0.8, fadeIn(zoom, 3.5, 1.0));
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

	// --- input ---

	private bindInput(): void {
		const canvas = this.canvas;

		const onWheel = (e: WheelEvent): void => {
			e.preventDefault();
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
				this.cacheTransform();
				this.view.panX = this.dragStartPanX + (e.clientX - this.dragStartX) / this.scale;
				this.view.panY = this.dragStartPanY + (e.clientY - this.dragStartY) / this.scale;
				this.markDirty();
				this.cb.onHover(null, 0, 0);
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
