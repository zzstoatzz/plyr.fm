/** How long the player may show its loading state before it gives up and resets. */
export const STUCK_LOADING_MS = 20_000;

/**
 * Fires once when loading has stayed on for `limit` without a break. Every
 * wait behind loading has its own timeout; this catches the ones that keep
 * being re-armed, so the listener is never left on a spinner with no way out.
 */
export class LoadingWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly stuck: () => void;
  private readonly limit: number;

  constructor(stuck: () => void, limit = STUCK_LOADING_MS) {
    this.stuck = stuck;
    this.limit = limit;
  }

  /** Report the current loading state; the clock runs only while it stays true. */
  update(loading: boolean) {
    if (!loading) { clearTimeout(this.timer); this.timer = undefined; return; }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.stuck(); }, this.limit);
  }

  dispose() { clearTimeout(this.timer); this.timer = undefined; }
}
