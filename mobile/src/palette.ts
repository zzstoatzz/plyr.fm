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
