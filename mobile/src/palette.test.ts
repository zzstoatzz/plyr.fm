import { describe, expect, test } from "bun:test";
import { contrast, mix, palette, tint, type Mode, type Role } from "./palette";

const modes: Mode[] = ["light", "dark", "highContrastLight", "highContrastDark"];
const grounds: Role[] = ["canvas", "surface", "raised"];
const text: Role[] = ["ink", "muted", "accent", "danger"];

describe("palette", () => {
  for (const mode of modes) {
    const floor = mode.startsWith("highContrast") ? 7 : 4.5;
    for (const fg of text) {
      for (const bg of grounds) {
        test(`${mode}: ${fg} on ${bg} reads at ${floor}:1`, () => {
          expect(contrast(palette[fg][mode], palette[bg][mode])).toBeGreaterThanOrEqual(floor);
        });
      }
    }
    test(`${mode}: label on accent reads at 4.5:1`, () => {
      expect(contrast(palette.onAccent[mode], palette.accent[mode])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("accent tint", () => {
  test("mixes like the web's color-mix over an opaque ground", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#6A9FFF", "#141414", 0)).toBe("#141414");
  });

  for (const mode of modes) {
    test(`accent text reads on the tinted fill in ${mode}`, () => {
      const floor = mode.startsWith("highContrast") ? 7 : 4.5;
      expect(contrast(palette.accent[mode], tint.fill[mode])).toBeGreaterThanOrEqual(floor);
    });
  }
});
