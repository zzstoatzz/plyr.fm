import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import baseline from "../docs/internal/contracts/client-api.json";
import {
  AlbumSearchResult,
  AlbumSummary,
  Artist,
  ArtistSearchResult,
  AudioUrl,
  FeaturedArtist,
  Playlist,
  PlaylistSearchResult,
  TagDetail,
  TagSearchResult,
  TagWithCount,
  Track,
  TrackSearchResult,
  parseSearch,
  parseTrackPage,
  parseTrackSearch,
} from "./contract";

type Schema = { properties: Record<string, unknown>; required?: string[] };
const schemas = baseline.components.schemas as Record<string, Schema>;

const cases: [string, z.ZodObject][] = [
  ["TrackResponse", Track],
  ["AlbumSummary", AlbumSummary],
  ["FeaturedArtist", FeaturedArtist],
  ["AudioUrlResponse", AudioUrl],
  ["TrackSearchResult", TrackSearchResult],
  ["ArtistSearchResult", ArtistSearchResult],
  ["AlbumSearchResult", AlbumSearchResult],
  ["TagSearchResult", TagSearchResult],
  ["PlaylistSearchResult", PlaylistSearchResult],
  ["ArtistResponse", Artist],
  ["TagWithCount", TagWithCount],
  ["TagDetail", TagDetail],
  ["PlaylistWithTracksResponse", Playlist],
];

describe("contract", () => {
  for (const [name, schema] of cases) {
    test(`${name}: every field we read is served`, () => {
      const served = schemas[name];
      for (const field of Object.keys(schema.shape)) expect(served.properties).toHaveProperty(field);
    });

    test(`${name}: every field we require is required by the server`, () => {
      const required = new Set(schemas[name].required ?? []);
      for (const [field, type] of Object.entries(schema.shape)) {
        const optional = (type as z.ZodType).safeParse(undefined).success;
        if (!optional && field !== "type") expect(required).toContain(field);
      }
    });
  }

  test("one malformed track is dropped, not the page", () => {
    const good = {
      id: 1,
      title: "t",
      artist: "a",
      artist_handle: "a.test",
      artist_did: "did:plc:a",
      artist_avatar_url: null,
      file_id: "f",
      file_type: "mp3",
      play_count: 0,
      like_count: 0,
      created_at: "2026-10-07T00:00:00Z",
      image_url: null,
      album: null,
    };
    const rejected: unknown[] = [];
    const page = parseTrackPage({ tracks: [good, { id: "nope" }], next_cursor: "c", has_more: true }, (e) => rejected.push(e));
    expect(page.tracks.map((t) => t.id)).toEqual([1]);
    expect(page.tracks[0].gated).toBe(false);
    expect(page.nextCursor).toBe("c");
    expect(rejected).toHaveLength(1);
  });

  test("search keeps tracks and ignores other kinds", () => {
    const results = parseTrackSearch({
      results: [
        { type: "artist", did: "did:plc:a", handle: "a", display_name: "A", avatar_url: null, relevance: 1 },
        { type: "track", id: 7, title: "t", artist_handle: "a", artist_display_name: "A", image_url: null, relevance: 1 },
      ],
      counts: {},
    });
    expect(results.map((r) => r.id)).toEqual([7]);
  });

  test("search keeps every known kind and skips unknown ones", () => {
    const results = parseSearch({
      results: [
        { type: "artist", did: "did:plc:a", handle: "a", display_name: "A", avatar_url: null, relevance: 1 },
        { type: "track", id: 7, title: "t", artist_handle: "a", artist_display_name: "A", image_url: null, relevance: 1 },
        { type: "tag", id: 3, name: "ambient", track_count: 4, relevance: 1 },
        { type: "station", id: 1 },
        { type: "album", id: "x" },
      ],
      counts: {},
    });
    expect(results.map((r) => r.type)).toEqual(["artist", "track", "tag"]);
  });
});
