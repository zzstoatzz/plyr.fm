import { describe, expect, test } from "bun:test";
import type { Track } from "plyr-shared/contract";
import { addToQueue, EMPTY_QUEUE, jumpTo, playContext } from "plyr-shared/queue";
import { smallImage, upNextRows, upNextTarget } from "./upNext";

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
  created_at: "2026-10-07T00:00:00Z",
  image_url: null,
  album: null,
  tags: [],
  gated: false,
  ...extra,
});

const any = () => true;
const list = (ids: number[]) => ids.map((id) => track(id));
const playing = (ids: number[]) => {
  const queue = playContext(EMPTY_QUEUE, list(ids), 0, null, any);
  if (!queue) throw new Error("nothing playable");
  return queue;
};

describe("up next rows", () => {
  test("nothing follows a single track or an empty queue", () => {
    expect(upNextRows(EMPTY_QUEUE, any)).toBeNull();
    expect(upNextRows(playing([1]), any)).toBeNull();
    expect(upNextRows(jumpTo(playing([1, 2]), 1), any)).toBeNull();
  });

  test("the next three are rows and the rest is a count", () => {
    const next = upNextRows(playing([1, 2, 3, 4, 5, 6]), any);
    expect(next?.rows.map((row) => row.title)).toEqual(["t2", "t3", "t4"]);
    expect(next?.more).toBe(2);
    expect(upNextRows(playing([1, 2]), any)).toMatchObject({ more: 0, rows: [{ title: "t2", by: "a" }] });
  });

  test("hand-queued picks come before the rest of the list", () => {
    const next = upNextRows(addToQueue(playing([1, 2, 3]), list([9])), any);
    expect(next?.rows.map((row) => row.title)).toEqual(["t9", "t2", "t3"]);
  });

  test("tracks that cannot play here are neither shown nor counted", () => {
    const next = upNextRows(playing([1, 2, 3, 4, 5]), (t) => t.id !== 2 && t.id !== 5);
    expect(next?.rows.map((row) => row.title)).toEqual(["t3", "t4"]);
    expect(next?.more).toBe(0);
  });

  test("the whole payload stays far under ActivityKit's 4 KB", () => {
    const long = "x".repeat(500);
    const queue = playContext(EMPTY_QUEUE, [1, 2, 3, 4].map((id) => track(id, { title: long, artist: long })), 0, null, any);
    const next = queue && upNextRows(queue, any);
    expect(JSON.stringify(next).length).toBeLessThan(1024);
  });
});

describe("a tapped row", () => {
  const queue = playing([1, 2, 3, 4]);

  test("names its place in the queue", () => {
    const target = upNextRows(queue, any)?.rows[1]?.target ?? "";
    expect(upNextTarget(queue, target)).toBe(2);
  });

  test("is ignored once the queue has moved on", () => {
    const target = upNextRows(queue, any)?.rows[0]?.target ?? "";
    expect(upNextTarget(jumpTo(queue, 2), target)).toBe(-1);
    expect(upNextTarget(playing([1, 7, 8]), target)).toBe(-1);
    expect(upNextTarget(queue, "nonsense")).toBe(-1);
  });
});

describe("small image", () => {
  test("the plyr CDN is asked for a thumb-sized rendition", () => {
    expect(smallImage(track(1, { image_url: "https://images.plyr.fm/images/x.jpg" }))).toBe("https://images.plyr.fm/cdn-cgi/image/width=96,quality=82,format=auto/images/x.jpg");
  });

  test("a Bluesky avatar uses its thumbnail rendition", () => {
    expect(smallImage(track(1, { artist_avatar_url: "https://cdn.bsky.app/img/avatar/plain/did:plc:a/cid" }))).toBe("https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:a/cid");
  });

  test("an image of unknown size is left out", () => {
    expect(smallImage(track(1, { artist_avatar_url: "https://example.com/huge.png" }))).toBeNull();
    expect(smallImage(track(1))).toBeNull();
  });
});
