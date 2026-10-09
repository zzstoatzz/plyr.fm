/** The web player's top edge line (Player.svelte `.player::before`): accent, dim at rest, bright with a glow while playing. */
export const TOP_BAR = {
  height: 1,
  fadeMs: 150,
  resting: { opacity: 0.32, saturate: 0.9, brightness: 0.75 },
  playing: { opacity: 0.95, saturate: 1.25, brightness: 1.28 },
  glow: [
    { blur: 6, alpha: 0.65 },
    { blur: 14, alpha: 0.45 },
  ],
} as const;

/** What the line turns into while a jam is active; the gradient closes on its first color. */
export const RAINBOW = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#9b59b6"] as const;

/** A hex color through CSS `filter: saturate() brightness()`, in that order. */
export function filtered(hex: string, { saturate, brightness }: { saturate: number; brightness: number }): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const s = saturate;
  const out = [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ].map((channel) => Math.round(Math.min(255, Math.max(0, channel * brightness))));
  return `#${out.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
