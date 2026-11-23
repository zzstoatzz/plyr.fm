import type { AtlasArtist, AtlasPoint } from './types';

const IN_FLIGHT = 6;

/** artist avatars for the atlas: loaded biggest-on-screen first, a few at a time, and kept as circle-cut sprites */
export class ArtistFaces {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  private loading = new Set<string>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private wanted: { a: AtlasArtist; pr: number }[] = [];

  constructor(private onLoad: () => void) {}

  /** the face to draw at `px` device pixels across, or undefined while it loads or when there is none */
  face(a: AtlasArtist, pr: number, px: number): HTMLCanvasElement | undefined {
    const img = this.images.get(a.did);
    if (img) return this.sprite(a.did, img, px);
    if (a.avatar && !this.failed.has(a.did) && !this.loading.has(a.did)) this.wanted.push({ a, pr });
    return undefined;
  }

  /** start loads for this frame's missing faces, biggest first */
  flush(): void {
    const slots = IN_FLIGHT - this.loading.size;
    if (slots > 0 && this.wanted.length) {
      this.wanted.sort((p, q) => q.pr - p.pr);
      for (const { a } of this.wanted.slice(0, slots)) this.load(a);
    }
    this.wanted = [];
  }

  private load(a: AtlasArtist): void {
    this.loading.add(a.did);
    const img = new Image();
    img.src = a.avatar;
    // decoded off the main thread, so the frame that first draws it doesn't stall
    img.decode().then(
      () => (img.naturalWidth > 0 ? this.images.set(a.did, img) : this.failed.add(a.did)),
      () => this.failed.add(a.did)
    ).finally(() => {
      this.loading.delete(a.did);
      this.onLoad();
    });
  }

  // the power-of-two size nearest the drawn size, so small faces don't shimmer
  private sprite(did: string, img: HTMLImageElement, px: number): HTMLCanvasElement {
    const size = Math.max(16, Math.min(256, 2 ** Math.ceil(Math.log2(px))));
    const key = `${did}:${size}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();
    // cover-fit a non-square avatar
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    this.sprites.set(key, cv);
    return cv;
  }
}

/**
 * how present each artist is on the map, 0..1, from what listeners do with
 * their tracks: plays, with a like worth 30 plays. never from how many tracks
 * they uploaded, so a big archive alone doesn't make an artist loom.
 */
export function artistReach(points: AtlasPoint[], artists: AtlasArtist[]): Float32Array<ArrayBuffer> {
  const score = new Map<string, number>();
  for (const p of points) score.set(p.handle, (score.get(p.handle) ?? 0) + p.plays + p.likes * 30);
  const raw = artists.map(a => score.get(a.handle) ?? 0);
  const top = Math.max(1, ...raw);
  return Float32Array.from(raw, s => Math.sqrt(s / top));
}
