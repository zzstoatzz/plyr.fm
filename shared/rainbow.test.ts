import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RAINBOW } from "./rainbow";

test("the rainbow is the web player's top bar gradient", () => {
  const source = readFileSync(new URL("../frontend/src/lib/components/player/Player.svelte", import.meta.url), "utf8");
  const gradient = /--top-bar-color: linear-gradient\(90deg, ([^)]+)\)/.exec(source)?.[1];
  expect(gradient?.split(", ")).toEqual([...RAINBOW, RAINBOW[0]]);
});
