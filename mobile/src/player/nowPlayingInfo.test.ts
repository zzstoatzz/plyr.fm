import { describe, expect, test } from "bun:test";
import type { Track } from "plyr-shared/contract";
import { nowPlayingInfo } from "./nowPlayingInfo";

const track = (extra: Partial<Track> = {}): Track => ({
  id: 1,
  title: "t",
  artist: "a",
  artist_handle: "a.test",
  artist_did: "did:plc:a",
  artist_avatar_url: null,
  file_id: "f",
  file_type: "mp3",
  features: [],
  play_count: 0,
  like_count: 0,
  created_at: "2026-10-07T00:00:00Z",
  image_url: "https://images.plyr.fm/images/x.jpg",
  album: null,
  tags: [],
  gated: false,
  ...extra,
});

describe("now playing info", () => {
  test("every text field is sent, so nothing is inherited from the last track", () => {
    const info = nowPlayingInfo(track(), { status: "loading", position: 0, duration: 0 });
    expect(info.album).toBe("");
    expect(info.duration).toBe(0);
    expect(Object.values({ title: info.title, artist: info.artist, album: info.album, duration: info.duration, elapsedTime: info.elapsedTime })).not.toContain(undefined);
  });

  test("featured artists are credited and artwork is asked for at display size", () => {
    const info = nowPlayingInfo(track({ features: [{ did: "d", handle: "b.test", display_name: "b" }], album: { id: "1", slug: "s", title: "al", image_url: null } }), {
      status: "playing",
      position: 3,
      duration: 60,
    });
    expect(info.artist).toBe("a, b");
    expect(info.album).toBe("al");
    expect(info.artwork).toContain("width=640");
  });

  test("the clock runs only while audio moves", () => {
    const at = (status: Parameters<typeof nowPlayingInfo>[1]["status"]) => nowPlayingInfo(track(), { status, position: 5, duration: 60 });
    expect([at("playing").speed, at("playing").state]).toEqual([1, "playing"]);
    expect([at("buffering").speed, at("buffering").state]).toEqual([0, "playing"]);
    expect([at("paused").speed, at("paused").state]).toEqual([0, "paused"]);
    expect([at("failed").speed, at("failed").state]).toEqual([0, "paused"]);
  });
});
