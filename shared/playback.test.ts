import { describe, expect, test } from "bun:test";
import * as web from "../frontend/src/lib/skip-step";
import { listeningLabel as webListeningLabel } from "../frontend/src/lib/publishing";
import type { Track } from "./contract";
import { formatTime } from "./format";
import { listeningLabel, playability, playCountThreshold, skipStepSeconds, SKIP_STEP_LADDER, SKIP_STEP_MAX } from "./playback";
import { EMPTY_QUEUE, current, next, previous, start } from "./queue";

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
const canPlay = (t: Track) => playability(t, mp3Only).playable;

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
});

describe("queue", () => {
  const list = [track(1), track(2, { gated: true }), track(3)];

  test("starting on an unplayable track skips forward", () => {
    expect(current(start(list, 1, canPlay))?.id).toBe(3);
    expect(start([track(9, { gated: true })], 0, canPlay)).toBe(EMPTY_QUEUE);
  });

  test("next skips what cannot play and stops at the end", () => {
    const q = start(list, 0, canPlay);
    const after = next(q, canPlay);
    expect(after && current(after)?.id).toBe(3);
    expect(after && next(after, canPlay)).toBeNull();
  });

  test("previous restarts after a moment, otherwise steps back past what cannot play", () => {
    const q = { tracks: list, index: 2 };
    expect(previous(q, 5, canPlay)).toEqual({ kind: "restart" });
    expect(previous(q, 0.5, canPlay)).toEqual({ kind: "move", queue: { tracks: list, index: 0 } });
    expect(previous({ tracks: list, index: 0 }, 0, canPlay)).toEqual({ kind: "restart" });
  });
});
