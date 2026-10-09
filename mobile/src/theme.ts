import { DynamicColorIOS } from "react-native";
import { accentFor, palette, type Accent } from "./palette";

const dynamic = DynamicColorIOS;

export const color = {
  canvas: dynamic(palette.canvas),
  surface: dynamic(palette.surface),
  raised: dynamic(palette.raised),
  fill: dynamic(palette.fill),
  ink: dynamic(palette.ink),
  muted: dynamic(palette.muted),
  border: dynamic(palette.border),
  onAccent: dynamic(palette.onAccent),
  danger: dynamic(palette.danger),
} satisfies Record<Exclude<keyof typeof palette, "accent">, ReturnType<typeof DynamicColorIOS>>;

const accents = new Map<string | null, Record<keyof Accent, ReturnType<typeof DynamicColorIOS>>>();

/** The accent colors for a listener's choice, as system colors that follow light, dark and increased contrast. Read through `useAccent`. */
export function accentColors(chosen: string | null) {
  const known = accents.get(chosen);
  if (known) return known;
  const { accent, tintFill, tintBorder, edge } = accentFor(chosen);
  const made = { accent: dynamic(accent), tintFill: dynamic(tintFill), tintBorder: dynamic(tintBorder), edge: dynamic(edge) };
  accents.set(chosen, made);
  return made;
}

export const inset = 20;
export const thumb = 48;
/** Where row text begins: inset + artwork + 12pt gap. */
export const column = inset + thumb + 12;
export const radius = { art: 6, card: 8, hero: 12, sheet: 24 } as const;
