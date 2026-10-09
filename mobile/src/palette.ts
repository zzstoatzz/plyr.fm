export type Mode = "light" | "dark" | "highContrastLight" | "highContrastDark";
export type Variants = Record<Mode, string>;

const role = (light: string, dark: string, highContrastLight: string, highContrastDark: string) => ({
  light,
  dark,
  highContrastLight,
  highContrastDark,
});

// seeded from the web tokens in frontend/src/routes/+layout.svelte; palette.test.ts checks contrast
export const palette = {
  canvas: role("#FAFAFA", "#0A0A0A", "#FFFFFF", "#000000"),
  surface: role("#FFFFFF", "#141414", "#FFFFFF", "#0A0A0A"),
  raised: role("#F5F5F5", "#1A1A1A", "#F0F0F0", "#141414"),
  fill: role("#EBEBEB", "#1F1F1F", "#E0E0E0", "#262626"),
  ink: role("#171717", "#E8E8E8", "#000000", "#FFFFFF"),
  muted: role("#525252", "#B0B0B0", "#3A3A3A", "#D4D4D4"),
  border: role("#E5E5E5", "#282828", "#8A8A8A", "#8A8A8A"),
  // blue means "you can act on this" or "this is playing"
  accent: role("#2D63C8", "#6A9FFF", "#1A4590", "#9CC0FF"),
  onAccent: role("#FFFFFF", "#0A0A0A", "#FFFFFF", "#000000"),
  danger: role("#C81E1E", "#EF4444", "#991B1B", "#FCA5A5"),
} satisfies Record<string, Variants>;

export type Role = keyof typeof palette;

const MODES = ["light", "dark", "highContrastLight", "highContrastDark"] as const satisfies readonly Mode[];

/** `amount` of `over` laid on `under`, as the web's color-mix does on an opaque ground. */
export function mix(over: string, under: string, amount: number): string {
  const [a, b] = [over, under].map((hex) => Number.parseInt(hex.slice(1), 16));
  const blend = (shift: number) => Math.round(((a >> shift) & 255) * amount + ((b >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((shift) => blend(shift).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const tinted = (amount: number): Variants => {
  const [light, dark, highContrastLight, highContrastDark] = MODES.map((mode) => mix(palette.accent[mode], palette.surface[mode], amount));
  return { light, dark, highContrastLight, highContrastDark };
};

// the web's support button: accent at 15% for the fill and 40% for the edge, over the profile card
export const tint = { fill: tinted(0.15), border: tinted(0.4) } satisfies Record<string, Variants>;

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
