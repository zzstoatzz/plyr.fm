import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Track } from "./contract";
import {
  EMPTY_QUEUE,
  addToQueue,
  clearUpNext,
  current,
  hasNext,
  jumpTo,
  move,
  next,
  playContext,
  playNext,
  playNow,
  previous,
  remove,
  restore,
  save,
  shuffleUpNext,
  tail,
  toggleRepeat,
  upNext,
  type Queue,
} from "./queue";

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

const list = (ids: number[]) => ids.map((id) => track(id));
const canPlay = (t: Track) => !t.gated;
const ids = (queue: Queue) => queue.tracks.map((t) => t.id);
const context = (queue: Queue, tracks: readonly Track[], index: number, label: string | null = "road mix") => {
  const played = playContext(queue, tracks, index, label, canPlay);
  if (!played) throw new Error("nothing playable");
  return played;
};

// the cases of frontend/src/lib/queue-context.test.ts, against the same rules as pure functions
describe("playContext", () => {
  test("plays the tapped track and queues the rest of the list as a labeled tail", () => {
    const q = context(EMPTY_QUEUE, list([1, 2, 3, 4, 5]), 2);
    expect(current(q)?.id).toBe(3);
    expect(ids(q)).toEqual([3, 4, 5]);
    expect(q.tailFrom).toBe(1);
    expect(q.tailLabel).toBe("road mix");
    expect(upNext(q)).toEqual([]);
    expect(tail(q).map((e) => [e.track.id, e.index])).toEqual([[4, 1], [5, 2]]);
  });

  test("keeps hand-queued picks across the switch, ahead of the new tail", () => {
    const seeded = addToQueue(playNow(EMPTY_QUEUE, track(10)), list([11, 12]));
    const q = context(seeded, list([20, 21, 22, 23]), 1, "album x");
    expect(ids(q)).toEqual([21, 11, 12, 22, 23]);
    expect(q.index).toBe(0);
    expect(q.tailFrom).toBe(3);
    expect(q.tailLabel).toBe("album x");
  });

  test("leaves no tail and no label when the last track is tapped", () => {
    const q = context(EMPTY_QUEUE, list([1, 2, 3]), 2);
    expect(ids(q)).toEqual([3]);
    expect(q.tailFrom).toBe(1);
    expect(q.tailLabel).toBeNull();
  });

  test("does not repeat a track already picked", () => {
    const seeded = addToQueue(playNow(EMPTY_QUEUE, track(1)), list([4]));
    expect(ids(context(seeded, list([3, 4, 5]), 0))).toEqual([3, 4, 5]);
  });

  test("a tap on something that cannot play starts at the next thing that can", () => {
    const tracks = [track(1), track(2, { gated: true }), track(3)];
    expect(current(context(EMPTY_QUEUE, tracks, 1))?.id).toBe(3);
    expect(playContext(EMPTY_QUEUE, [track(9, { gated: true })], 0, null, canPlay)).toBeNull();
  });

  test("the web's playContext has the same shape", () => {
    const source = readFileSync(new URL("../frontend/src/lib/queue.svelte.ts", import.meta.url), "utf8");
    expect(source).toContain("this.tracks = [tapped, ...upNext, ...contextTail];");
    expect(source).toContain("this.continuationFromIndex = 1 + upNext.length;");
    expect(source).toContain("const insertAt = Math.max(this.continuationFromIndex, this.currentIndex + 1);");
  });
});

describe("queueing by hand", () => {
  const playing = context(EMPTY_QUEUE, list([1, 2, 3]), 0);

  test("add to queue lands after earlier picks and ahead of the tail", () => {
    const q = addToQueue(addToQueue(playing, [track(7)]), [track(8)]);
    expect(ids(q)).toEqual([1, 7, 8, 2, 3]);
    expect(upNext(q).map((e) => e.track.id)).toEqual([7, 8]);
    expect(tail(q).map((e) => e.track.id)).toEqual([2, 3]);
    expect(q.tailLabel).toBe("road mix");
  });

  test("play next goes ahead of every other pick", () => {
    const q = playNext(addToQueue(playing, [track(7)]), track(8));
    expect(ids(q)).toEqual([1, 8, 7, 2, 3]);
    expect(q.tailFrom).toBe(3);
  });

  test("an empty queue starts with what was added", () => {
    expect(current(addToQueue(EMPTY_QUEUE, list([5, 6])))?.id).toBe(5);
    expect(current(playNext(EMPTY_QUEUE, track(5)))?.id).toBe(5);
    expect(addToQueue(playing, [])).toBe(playing);
  });

  test("a pick made while playing inside the tail still plays next", () => {
    const inside = jumpTo(playing, 1);
    const q = addToQueue(inside, [track(7)]);
    expect(ids(q)).toEqual([1, 2, 7, 3]);
    expect(upNext(q).map((e) => e.track.id)).toEqual([7]);
    expect(tail(q).map((e) => e.track.id)).toEqual([3]);
  });

  test("the same track can be queued twice", () => {
    const q = addToQueue(addToQueue(playing, [track(7)]), [track(7)]);
    expect(upNext(q).map((e) => e.index)).toEqual([1, 2]);
  });

  test("play now keeps picks and drops the tail", () => {
    const q = playNow(addToQueue(playing, [track(7)]), track(9));
    expect(ids(q)).toEqual([9, 7]);
    expect(q.tailLabel).toBeNull();
    expect(tail(q)).toEqual([]);
  });

  test("clear up next forgets the picks and keeps the tail", () => {
    const q = clearUpNext(addToQueue(playing, list([7, 8])));
    expect(ids(q)).toEqual([1, 2, 3]);
    expect(q.tailFrom).toBe(1);
    expect(q.tailLabel).toBe("road mix");
    expect(clearUpNext(playing)).toBe(playing);
  });
});

describe("move and remove", () => {
  // current 1, picks 7 8, tail 2 3
  const q = addToQueue(context(EMPTY_QUEUE, list([1, 2, 3]), 0), list([7, 8]));

  test("picks reorder among themselves", () => {
    expect(ids(move(q, 1, 2))).toEqual([1, 8, 7, 2, 3]);
    expect(move(q, 1, 2).tailFrom).toBe(3);
  });

  test("a pick cannot be buried in the tail", () => {
    const moved = move(q, 1, 4);
    expect(ids(moved)).toEqual([1, 8, 7, 2, 3]);
    expect(moved.tailFrom).toBe(3);
  });

  test("a tail track dragged above the boundary becomes a pick", () => {
    const moved = move(q, 4, 1);
    expect(ids(moved)).toEqual([1, 3, 7, 8, 2]);
    expect(upNext(moved).map((e) => e.track.id)).toEqual([3, 7, 8]);
    expect(tail(moved).map((e) => e.track.id)).toEqual([2]);
  });

  test("the tail reorders within itself", () => {
    expect(ids(move(q, 3, 4))).toEqual([1, 7, 8, 3, 2]);
    expect(move(q, 3, 4).tailFrom).toBe(3);
  });

  test("the current track stays current when others move around it", () => {
    const mid = jumpTo(q, 2);
    expect(current(move(mid, 0, 3))?.id).toBe(8);
    expect(current(move(mid, 4, 0))?.id).toBe(8);
    expect(current(move(mid, 2, 1))?.id).toBe(8);
  });

  test("out-of-range and no-op moves change nothing", () => {
    expect(move(q, 1, 1)).toBe(q);
    expect(move(q, -1, 2)).toBe(q);
    expect(move(q, 1, 9)).toBe(q);
  });

  test("removing a pick pulls the tail boundary in; removing from the tail does not", () => {
    expect(remove(q, 1).tailFrom).toBe(2);
    expect(ids(remove(q, 1))).toEqual([1, 8, 2, 3]);
    expect(remove(q, 4).tailFrom).toBe(3);
    expect(remove(remove(q, 4), 3).tailLabel).toBeNull();
  });

  test("the current track cannot be removed, and removing before it keeps it current", () => {
    expect(remove(q, 0)).toBe(q);
    const mid = jumpTo(q, 2);
    expect(current(remove(mid, 0))?.id).toBe(8);
    expect(remove(q, 9)).toBe(q);
  });

  test("removing one of two identical entries leaves the other", () => {
    const twice = addToQueue(playNow(EMPTY_QUEUE, track(1)), [track(7), track(7)]);
    expect(ids(remove(twice, 1))).toEqual([1, 7]);
  });
});

describe("shuffle", () => {
  const q = addToQueue(context(EMPTY_QUEUE, list([1, 2, 3]), 0), list([7, 8, 9]));

  test("reorders the picks only and never returns the same order", () => {
    const shuffled = shuffleUpNext(q);
    expect(shuffled.tracks[0].id).toBe(1);
    expect(ids(shuffled).slice(4)).toEqual([2, 3]);
    expect(ids(shuffled).slice(1, 4).sort()).toEqual([7, 8, 9]);
    expect(ids(shuffled).slice(1, 4)).not.toEqual([7, 8, 9]);
    expect(shuffled.tailFrom).toBe(q.tailFrom);
  });

  test("gives up rather than loop when chance keeps returning the same order", () => {
    expect(ids(shuffleUpNext(q, () => 0.999))).toEqual(ids(q));
  });

  test("one pick or none is left alone", () => {
    const one = addToQueue(playNow(EMPTY_QUEUE, track(1)), [track(2)]);
    expect(shuffleUpNext(one)).toBe(one);
    expect(shuffleUpNext(EMPTY_QUEUE)).toBe(EMPTY_QUEUE);
  });
});

describe("stepping", () => {
  const tracks = [track(1), track(2, { gated: true }), track(3)];
  const q = context(EMPTY_QUEUE, tracks, 0);

  test("next skips what cannot play, keeps the tail, and stops at the end", () => {
    const after = next(q, canPlay);
    expect(after && current(after)?.id).toBe(3);
    expect(after?.tailLabel).toBe("road mix");
    expect(after && next(after, canPlay)).toBeNull();
    expect(hasNext(q, canPlay)).toBe(true);
    expect(next(EMPTY_QUEUE, canPlay)).toBeNull();
  });

  test("previous restarts after a moment, otherwise steps back past what cannot play", () => {
    const end = jumpTo(q, 2);
    expect(previous(end, 5, canPlay)).toEqual({ kind: "restart" });
    expect(previous(end, 0.5, canPlay)).toEqual({ kind: "move", queue: { ...end, index: 0 } });
    expect(previous(q, 0, canPlay)).toEqual({ kind: "restart" });
  });

  test("repeat is one track or nothing", () => {
    expect(toggleRepeat("none")).toBe("one");
    expect(toggleRepeat("one")).toBe("none");
  });
});

describe("saved queue", () => {
  const q = jumpTo(addToQueue(context(EMPTY_QUEUE, list([1, 2, 3]), 0), list([7])), 1);

  test("comes back as it was", () => {
    expect(restore(save({ queue: q, position: 42.5, repeat: "one" }))).toEqual({ queue: q, position: 42.5, repeat: "one" });
  });

  test("nothing saved, or something unreadable, restores nothing", () => {
    for (const text of [null, "", "{", "[]", JSON.stringify({ tracks: [], index: 0, tailFrom: 0, tailLabel: null, position: 0, repeat: "none" })])
      expect(restore(text)).toBeNull();
  });

  test("a stored track that no longer parses is dropped and the rest keep their places", () => {
    const raw = JSON.parse(save({ queue: q, position: 10, repeat: "none" }));
    raw.tracks[0] = { id: "nope" };
    const back = restore(JSON.stringify(raw));
    expect(back && ids(back.queue)).toEqual([7, 2, 3]);
    expect(back && current(back.queue)?.id).toBe(7);
    expect(back?.queue.tailFrom).toBe(1);
    expect(back?.position).toBe(10);
  });

  test("when the current track itself is gone, the queue restarts from its head at zero", () => {
    const raw = JSON.parse(save({ queue: q, position: 10, repeat: "none" }));
    raw.tracks[1] = null;
    const back = restore(JSON.stringify(raw));
    expect(back && current(back.queue)?.id).toBe(1);
    expect(back?.position).toBe(0);
  });
});
