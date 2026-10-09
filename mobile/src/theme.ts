import { DynamicColorIOS } from "react-native";
import { palette, tint } from "./palette";

const dynamic = DynamicColorIOS;

export const color = {
  canvas: dynamic(palette.canvas),
  surface: dynamic(palette.surface),
  raised: dynamic(palette.raised),
  fill: dynamic(palette.fill),
  ink: dynamic(palette.ink),
  muted: dynamic(palette.muted),
  border: dynamic(palette.border),
  accent: dynamic(palette.accent),
  onAccent: dynamic(palette.onAccent),
  danger: dynamic(palette.danger),
} satisfies Record<keyof typeof palette, ReturnType<typeof DynamicColorIOS>>;

export const accentTint = { fill: dynamic(tint.fill), border: dynamic(tint.border) };

export const inset = 20;
export const thumb = 48;
/** Where row text begins: inset + artwork + 12pt gap. */
export const column = inset + thumb + 12;
export const radius = { art: 6, card: 8, hero: 12 } as const;
