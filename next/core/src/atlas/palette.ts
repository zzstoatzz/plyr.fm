/** Colours and tuning the atlas shares across clients, so web and the app draw the same map. */

export type Rgb = [number, number, number];
export interface HueColors { core: Rgb; mid: Rgb; edge: Rgb }

export const HUE_STEPS = 24;

export const TUNE = {
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

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function fadeIn(zoom: number, start: number, range: number): number {
  return clamp01((zoom - start) / range);
}
export function fadeOut(zoom: number, start: number, range: number): number {
  return 1 - clamp01((zoom - start) / range);
}

export function hash01(id: number): number {
  let x = (id * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return hash01(h >>> 0);
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
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
  return [Math.round(f(p, q, h + 1 / 3) * 255), Math.round(f(p, q, h) * 255), Math.round(f(p, q, h - 1 / 3) * 255)];
}

export function rgba(rgb: Rgb, a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/** the hue step a fine cluster's tracks are coloured with */
export function hueStepOf(clusterFine: number): number {
  return Math.floor(hash01(clusterFine) * HUE_STEPS) % HUE_STEPS;
}

export function hueColors(step: number, dark: boolean): HueColors {
  const h = step / HUE_STEPS;
  const pal = dark ? TUNE.hueDark : TUNE.hueLight;
  return { core: hslToRgb(h, pal.core[0], pal.core[1]), mid: hslToRgb(h, pal.mid[0], pal.mid[1]), edge: hslToRgb(h, pal.edge[0], pal.edge[1]) };
}

/** a colour pushed `amount` of the way to white, for the bright centre of a star */
export function lighten(rgb: Rgb, amount: number): Rgb {
  return [Math.round(rgb[0] + (255 - rgb[0]) * amount), Math.round(rgb[1] + (255 - rgb[1]) * amount), Math.round(rgb[2] + (255 - rgb[2]) * amount)];
}

/** light mode's solid dot colour */
export function inkOf(colors: HueColors): Rgb {
  const m = colors.mid;
  return [Math.round(m[0] * 0.8), Math.round(m[1] * 0.8), Math.round(m[2] * 0.8)];
}

/** the tinted disk behind an artist's initial while their face loads or when they have none */
export function faceTint(did: string, dark: boolean): Rgb {
  return hslToRgb(hashText(did), 0.35, dark ? 0.28 : 0.82);
}
