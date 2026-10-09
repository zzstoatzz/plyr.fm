import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { filtered, RAINBOW, TOP_BAR } from "./topBar";

const source = readFileSync(new URL("../frontend/src/lib/components/player/Player.svelte", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start));
}

const number = (css: string, pattern: RegExp) => Number(pattern.exec(css)?.[1]);

function look(css: string) {
  return {
    saturate: number(css, /saturate\(([\d.]+)\)/),
    brightness: number(css, /brightness\(([\d.]+)\)/),
  };
}

test("the line has the web top bar's height, color and fade", () => {
  const css = rule(".player::before");
  expect(number(css, /height: (\d+)px/)).toBe(TOP_BAR.height);
  expect(number(css, /opacity ([\d.]+)s/) * 1000).toBe(TOP_BAR.fadeMs);
  expect(source).toContain("--top-bar-color: var(--accent);");
});

test("the line is the web player's top bar while playing", () => {
  const css = rule(".player.is-playing::before");
  expect(look(css)).toEqual(TOP_BAR.playing);
});

test("the rainbow is the web player's jam gradient", () => {
  const gradient = /--top-bar-color: linear-gradient\(90deg, ([^)]+)\)/.exec(rule(".player.jam-active"))?.[1];
  expect(gradient?.split(", ")).toEqual([...RAINBOW, RAINBOW[0]]);
});

test("filtered applies saturate then brightness as CSS does", () => {
  expect(filtered("#6A9FFF", { saturate: 1, brightness: 1 })).toBe("#6A9FFF");
  expect(filtered("#808080", { saturate: 1.25, brightness: 0.5 })).toBe("#404040");
  expect(filtered("#FF0000", { saturate: 0, brightness: 1 })).toBe("#363636");
  expect(filtered("#6A9FFF", TOP_BAR.playing)).toBe("#78CDFF");
});
