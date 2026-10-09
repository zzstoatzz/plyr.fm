import { describe, expect, test } from "bun:test";
import * as web from "../frontend/src/lib/skip-step";
import { listeningLabel as webListeningLabel } from "../frontend/src/lib/publishing";
import type { Track } from "./contract";
import { credits, formatTime } from "./format";
import { listeningLabel, playability, playCountThreshold, skipStepSeconds, SKIP_STEP_LADDER, SKIP_STEP_MAX } from "./playback";

const track = (id: number, extra: Partial<Track> = {}): Track => ({
  id,
  title: `t${id}`,
  artist: "a",
  artist_handle: "a.test",
  artist_did: "did:plc:a",
  artist_avatar_url: null,
  file_id: `f${id}`,
  file_type: "mp3",
  features: [],
  play_count: 0,
  like_count: 0,
  created_at: "",
  image_url: null,
  album: null,
  tags: [],
  gated: false,
  ...extra,
});

const mp3Only = (format: string) => format === "mp3";

describe("skip step matches the web app", () => {
  test("ladder", () => {
    expect(SKIP_STEP_LADDER).toEqual(web.SKIP_STEP_LADDER);
    expect(SKIP_STEP_MAX).toBe(web.SKIP_STEP_MAX);
  });
  for (const d of [Number.NaN, 0, -1, 30, 59.9, 60, 179, 180, 3600]) {
    test(`duration ${d}`, () => expect(skipStepSeconds(d)).toBe(web.skipStepSeconds(d)));
  }
});

describe("playback rules", () => {
  test("listening labels match the web app", () => {
    for (const policy of ["public", "signed_in", "supporters", "owner", "space", undefined] as const) {
      expect(listeningLabel(policy)).toBe(webListeningLabel(policy));
    }
  });

  test("play counts after 30 s or half the track", () => {
    expect(playCountThreshold(300)).toBe(30);
    expect(playCountThreshold(40)).toBe(20);
  });

  test("gated and undecodable interim renditions cannot start", () => {
    expect(playability(track(1, { gated: true }), mp3Only)).toEqual({ playable: false, reason: "gated" });
    const interim = track(2, { file_type: "aiff", original_file_id: "o", original_file_type: "aiff" });
    expect(playability(interim, mp3Only)).toEqual({ playable: false, reason: "processing" });
    expect(playability(interim, () => true)).toEqual({ playable: true });
  });

  test("time", () => {
    expect([formatTime(7), formatTime(201), formatTime(3729), formatTime(Number.NaN)]).toEqual(["0:07", "3:21", "1:02:09", "0:00"]);
  });

  test("credits name the artist, then anyone featured", () => {
    const feature = (display_name: string) => ({ did: "did:plc:f", handle: "f.test", display_name });
    expect(credits(track(1))).toBe("a");
    expect(credits(track(1, { features: [feature("b"), feature("c")] }))).toBe("a, b, c");
  });
});
