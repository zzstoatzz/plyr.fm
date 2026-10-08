import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SearchResult } from "./contract";
import { resultKey, resultSubtitle, resultTitle } from "./search";

const results: SearchResult[] = [
  { type: "track", id: 1, title: "t", artist_handle: "a.test", artist_display_name: "A", image_url: null },
  { type: "artist", did: "did:plc:a", handle: "a.test", display_name: "A", avatar_url: null },
  { type: "album", id: "x", title: "al", slug: "al", artist_handle: "a.test", artist_display_name: "A", image_url: null },
  { type: "tag", id: 2, name: "ambient", track_count: 1 },
  { type: "playlist", id: "p", name: "mix", owner_handle: "o.test", owner_display_name: "O", image_url: null, track_count: 3 },
];

test("titles and subtitles read as the web's search", () => {
  expect(results.map(resultTitle)).toEqual(["t", "A", "al", "ambient", "mix"]);
  expect(results.map(resultSubtitle)).toEqual(["by A", "@a.test", "by A", "1 track", "by O · 3 tracks"]);
});

test("subtitle wording matches SearchModal.svelte", () => {
  const source = readFileSync(new URL("../frontend/src/lib/components/SearchModal.svelte", import.meta.url), "utf8");
  for (const fragment of ["`by ${result.artist_display_name}`", "`@${result.handle}`", "`by ${result.owner_display_name} · ${result.track_count} track"])
    expect(source).toContain(fragment);
});

test("keys are unique across kinds", () => {
  expect(new Set(results.map(resultKey)).size).toBe(results.length);
});
