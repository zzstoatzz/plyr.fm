import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_HIDDEN_TAGS, orderTags, tagHue } from "./tags";

test("tag hue is stable and in range", () => {
  expect(tagHue("ambient")).toBe(tagHue("ambient"));
  for (const name of ["", "a", "lo-fi", "drum and bass", "ナイトコア"]) {
    const hue = tagHue(name);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  }
});

test("tag hue matches TagFilter.svelte", () => {
  const source = readFileSync(new URL("../frontend/src/lib/components/TagFilter.svelte", import.meta.url), "utf8");
  expect(source).toContain("hash = name.charCodeAt(i) + ((hash << 5) - hash);");
  expect(source).toContain("return ((hash % 360) + 360) % 360;");
});

test("default hidden tags match the backend", () => {
  const source = readFileSync(new URL("../backend/src/backend/utilities/tags.py", import.meta.url), "utf8");
  const listed = source.match(/DEFAULT_HIDDEN_TAGS: list\[str\] = \[(.*)\]/)?.[1];
  expect(listed?.split(",").map((s) => s.trim().replaceAll('"', ""))).toEqual([...DEFAULT_HIDDEN_TAGS]);
});

test("selected tags pin ahead, the rest sort by plays, hidden ones drop", () => {
  const tags = [
    { name: "pop", total_plays: 5, track_count: 1 },
    { name: "ai", total_plays: 99, track_count: 1 },
    { name: "jazz", total_plays: 9, track_count: 1 },
  ];
  expect(orderTags(tags, ["gone", "pop"]).map((t) => t.name)).toEqual(["gone", "pop", "jazz"]);
});
