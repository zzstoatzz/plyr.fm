import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCENT_PRESETS,
  DEFAULT_HIDDEN_TAGS,
  DEFAULT_SETTINGS,
  hidesDefaultTags,
  hideTag,
  isHidden,
  playsThroughCollections,
  restoreSettings,
  saveSettings,
  showTag,
} from "./settings";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../frontend/src/routes/settings/+page.svelte");
const preferences = read("../frontend/src/lib/preferences.svelte.ts");

test("the accent presets are the web's", () => {
  const presets = [...page.matchAll(/\{ name: '([a-z]+)', value: '(#[0-9a-f]{6})' \}/g)].map(([, name, value]) => ({ name, value }));
  expect(presets).toEqual([...ACCENT_PRESETS]);
});

test("defaults and field names are the web's preferences", () => {
  expect(preferences).toContain(`hidden_tags: [${DEFAULT_HIDDEN_TAGS.map((tag) => `'${tag}'`).join(", ")}]`);
  expect(preferences).toContain("accent_color: null");
  expect(preferences).toContain("this.data?.ui_settings?.atproto_client ?? null");
  expect(preferences).toContain("this.data?.ui_settings?.play_through_collections ?? true");
  expect(DEFAULT_SETTINGS).toEqual({ accent_color: null, hidden_tags: [...DEFAULT_HIDDEN_TAGS], ui_settings: {} });
  expect(playsThroughCollections(DEFAULT_SETTINGS)).toBe(true);
});

test("settings survive storage", () => {
  const settings = { accent_color: "#f472b6", hidden_tags: ["suno"], ui_settings: { atproto_client: "pdsls", play_through_collections: false } };
  expect(restoreSettings(saveSettings(settings))).toEqual(settings);
});

test("nothing stored, or junk, is the defaults", () => {
  expect(restoreSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(restoreSettings("{not json")).toEqual(DEFAULT_SETTINGS);
  expect(restoreSettings("[]")).toEqual(DEFAULT_SETTINGS);
});

test("one bad field falls back alone", () => {
  const restored = restoreSettings(JSON.stringify({ accent_color: "blue", hidden_tags: ["lofi"], ui_settings: { atproto_client: 7, play_through_collections: false } }));
  expect(restored).toEqual({ accent_color: null, hidden_tags: ["lofi"], ui_settings: { atproto_client: undefined, play_through_collections: false } });
});

test("hiding a tag stores it as the web would, once", () => {
  const hidden = hideTag(DEFAULT_SETTINGS, "  #LoFi ");
  expect(hidden.hidden_tags).toEqual([...DEFAULT_HIDDEN_TAGS, "lofi"]);
  expect(hideTag(hidden, "lofi")).toBe(hidden);
  expect(hideTag(hidden, "  ")).toBe(hidden);
  expect(showTag(hidden, "lofi").hidden_tags).toEqual([...DEFAULT_HIDDEN_TAGS]);
});

test("the server's filter is enough only for the default list, in any order", () => {
  expect(hidesDefaultTags(DEFAULT_SETTINGS)).toBe(true);
  expect(hidesDefaultTags({ ...DEFAULT_SETTINGS, hidden_tags: ["suno", "ai", "ai-slop"] })).toBe(true);
  expect(hidesDefaultTags(showTag(DEFAULT_SETTINGS, "suno"))).toBe(false);
  expect(hidesDefaultTags(hideTag(DEFAULT_SETTINGS, "lofi"))).toBe(false);
});

test("a track is hidden when any of its tags is", () => {
  expect(isHidden(DEFAULT_SETTINGS, ["ambient", "suno"])).toBe(true);
  expect(isHidden(DEFAULT_SETTINGS, ["ambient"])).toBe(false);
});
