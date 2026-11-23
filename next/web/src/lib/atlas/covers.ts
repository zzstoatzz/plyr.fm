const IN_FLIGHT = 12;

/**
 * track cover thumbnails for the atlas: the ones nearest the middle of the
 * screen load first, a few at a time, and each is kept as one rounded sprite
 * at the size it was last drawn, so a frame is plain drawImage calls.
 */
export class TrackCovers {
  private images = new Map<number, HTMLImageElement>();
  private failed = new Set<number>();
  private loading = new Set<number>();
  private sprites = new Map<number, { px: number; cv: HTMLCanvasElement }>();
  private wanted: { i: number; url: string; d: number }[] = [];

  constructor(private onLoad: () => void) {}

  /** the cover to draw `px` device pixels across, or undefined while it loads or when there is none */
  cover(i: number, url: string, px: number, d: number): HTMLCanvasElement | undefined {
    const img = this.images.get(i);
    if (img) return this.sprite(i, img, px);
    if (url && !this.failed.has(i) && !this.loading.has(i)) this.wanted.push({ i, url, d });
    return undefined;
  }

  /** start loads for this frame's missing covers, nearest the middle first */
  flush(): void {
    const slots = IN_FLIGHT - this.loading.size;
    if (slots > 0 && this.wanted.length) {
      this.wanted.sort((p, q) => p.d - q.d);
      for (const { i, url } of this.wanted.slice(0, slots)) this.load(i, url);
    }
    this.wanted = [];
  }

  private load(i: number, url: string): void {
    this.loading.add(i);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode off the main thread so the first frame that draws it doesn't stall
    img.decode().then(
      () => {
        this.loading.delete(i);
        this.images.set(i, img);
        this.onLoad();
      },
      () => {
        this.loading.delete(i);
        this.failed.add(i);
      }
    );
  }

  private sprite(i: number, img: HTMLImageElement, px: number): HTMLCanvasElement {
    // sizes snap to powers of two and draw scaled, so a zoom rebuilds a sprite rarely
    const size = Math.max(16, 2 ** Math.ceil(Math.log2(px)));
    const hit = this.sprites.get(i);
    if (hit?.px === size) return hit.cv;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, Math.max(2, size * 0.1));
    ctx.clip();
    const s = Math.min(img.naturalWidth, img.naturalHeight) || 1;
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    this.sprites.set(i, { px: size, cv });
    return cv;
  }
}
