import { z } from "zod";
import { Track } from "./contract";
import { RESTART_THRESHOLD_SECONDS } from "./playback";

// the rules of frontend/src/lib/queue.svelte.ts as pure functions; queue.test.ts ports its cases

export type Queue = {
  readonly tracks: readonly Track[];
  readonly index: number;
  /** Where the "next from" tail begins; `tracks.length` when there is none. Before it, after the current track, is what the listener queued by hand. */
  readonly tailFrom: number;
  /** What the tail continues: the album, playlist or list a track was tapped in. */
  readonly tailLabel: string | null;
};

export type Entry = { readonly track: Track; readonly index: number };

type CanPlay = (track: Track) => boolean;

export const EMPTY_QUEUE: Queue = { tracks: [], index: -1, tailFrom: 0, tailLabel: null };

function make(tracks: readonly Track[], index: number, tailFrom: number, tailLabel: string | null): Queue {
  if (tracks.length === 0) return EMPTY_QUEUE;
  const from = Math.max(0, Math.min(tailFrom, tracks.length));
  return { tracks, index, tailFrom: from, tailLabel: from < tracks.length ? tailLabel : null };
}

export function current(queue: Queue): Track | null {
  return queue.tracks[queue.index] ?? null;
}

/** Where the hand-queued picks end: the tail's start, or just past the current track once playback is inside the tail. */
function upNextEnd(queue: Queue): number {
  return Math.max(queue.index + 1, Math.min(queue.tailFrom, queue.tracks.length));
}

/** What the listener queued by hand, in order. */
export function upNext(queue: Queue): Entry[] {
  return queue.tracks.slice(queue.index + 1, upNextEnd(queue)).map((track, i) => ({ track, index: queue.index + 1 + i }));
}

/** The "next from: …" tail still ahead. */
export function tail(queue: Queue): Entry[] {
  const from = upNextEnd(queue);
  return queue.tracks.slice(from).map((track, i) => ({ track, index: from + i }));
}

/** Index of the next track after `from` that `canPlay` accepts, or -1 (frontend findNextPlayableIndex). */
export function nextPlayableIndex(queue: Pick<Queue, "tracks">, from: number, canPlay: CanPlay): number {
  for (let i = from + 1; i < queue.tracks.length; i++) if (canPlay(queue.tracks[i])) return i;
  return -1;
}

/**
 * Play a track tapped inside a list: it becomes the queue's head, hand-queued picks stay ahead,
 * and the rest of the list follows as the "next from: label" tail (frontend playContext).
 * Unlike the web, which checks access before it queues, a tap on something that cannot play
 * starts at the next thing that can; null when nothing can.
 */
export function playContext(queue: Queue, tracks: readonly Track[], startIndex: number, label: string | null, canPlay: CanPlay): Queue | null {
  if (tracks.length === 0) return null;
  const tappedAt = Math.max(0, Math.min(startIndex, tracks.length - 1));
  const start = nextPlayableIndex({ tracks }, tappedAt - 1, canPlay);
  if (start === -1) return null;
  const tapped = tracks[start];
  const picks = upNext(queue).map((entry) => entry.track);
  const ahead = new Set([tapped.id, ...picks.map((t) => t.id)]);
  const rest = tracks.slice(start + 1).filter((t) => !ahead.has(t.id));
  return make([tapped, ...picks, ...rest], 0, 1 + picks.length, label);
}

/** Play one track now, keeping hand-queued picks and dropping the old tail (frontend playNow). */
export function playNow(queue: Queue, track: Track): Queue {
  const picks = upNext(queue).map((entry) => entry.track);
  return make([track, ...picks], 0, 1 + picks.length, null);
}

function insert(queue: Queue, at: number, added: readonly Track[]): Queue {
  if (added.length === 0) return queue;
  if (!current(queue)) return make(added, 0, added.length, null);
  const tracks = [...queue.tracks.slice(0, at), ...added, ...queue.tracks.slice(at)];
  return make(tracks, queue.index, upNextEnd(queue) + added.length, queue.tailLabel);
}

/** Queue after the picks already made and ahead of the tail (frontend addTracks). An empty queue starts with them. */
export function addToQueue(queue: Queue, added: readonly Track[]): Queue {
  return insert(queue, upNextEnd(queue), added);
}

/** Queue right after the current track, ahead of every other pick. */
export function playNext(queue: Queue, track: Track): Queue {
  return insert(queue, queue.index + 1, [track]);
}

/** Jump to an entry already in the queue (frontend goTo). */
export function jumpTo(queue: Queue, index: number): Queue {
  return index >= 0 && index < queue.tracks.length ? { ...queue, index } : queue;
}

/**
 * Reorder (frontend moveTrack). A hand-queued pick cannot be buried in the tail; a tail track
 * dragged above the boundary becomes a pick. The current track keeps playing wherever it lands.
 */
export function move(queue: Queue, from: number, to: number): Queue {
  const size = queue.tracks.length;
  if (from < 0 || from >= size || to < 0 || to >= size) return queue;
  const boundary = queue.tailFrom;
  const fromTail = from >= boundary;
  const target = !fromTail && boundary < size ? Math.max(0, Math.min(to, boundary - 1)) : to;
  if (from === target) return queue;

  const tracks = [...queue.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(target, 0, moved);

  let index = queue.index;
  if (from === index) index = target;
  else if (from < index && target >= index) index -= 1;
  else if (from > index && target <= index) index += 1;

  return make(tracks, index, fromTail && target < boundary ? boundary + 1 : boundary, queue.tailLabel);
}

/** Make a tail track the last hand-queued pick (frontend promoteToUpNext). */
export function promote(queue: Queue, from: number): Queue {
  if (from < queue.tailFrom || from >= queue.tracks.length || from <= queue.index) return queue;
  const tracks = [...queue.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(upNextEnd(queue), 0, moved);
  return make(tracks, queue.index, upNextEnd(queue) + 1, queue.tailLabel);
}

/** Drop an entry (frontend removeTrack). The current track is not removable; skip it instead. */
export function remove(queue: Queue, index: number): Queue {
  if (index < 0 || index >= queue.tracks.length || index === queue.index) return queue;
  const tracks = queue.tracks.filter((_, i) => i !== index);
  return make(tracks, index < queue.index ? queue.index - 1 : queue.index, index < queue.tailFrom ? queue.tailFrom - 1 : queue.tailFrom, queue.tailLabel);
}

/** Forget the hand-queued picks; the tail keeps playing (frontend clearUpNext). */
export function clearUpNext(queue: Queue): Queue {
  const start = queue.index + 1;
  const end = upNextEnd(queue);
  if (end <= start) return queue;
  return make([...queue.tracks.slice(0, start), ...queue.tracks.slice(end)], queue.index, start, queue.tailLabel);
}

const SHUFFLE_ATTEMPTS = 10;

/**
 * Shuffle is an action, not a mode: it reorders the hand-queued picks once and leaves the
 * current track, what already played and the tail alone (frontend toggleShuffle).
 */
export function shuffleUpNext(queue: Queue, random: () => number = Math.random): Queue {
  const picks = upNext(queue).map((entry) => entry.track);
  if (picks.length <= 1) return queue;
  let shuffled = picks;
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS && shuffled.every((track, i) => track === picks[i]); attempt++) {
    shuffled = [...picks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  const start = queue.index + 1;
  return { ...queue, tracks: [...queue.tracks.slice(0, start), ...shuffled, ...queue.tracks.slice(start + picks.length)] };
}

export function hasNext(queue: Queue, canPlay: CanPlay): boolean {
  return nextPlayableIndex(queue, queue.index, canPlay) !== -1;
}

function previousPlayableIndex(queue: Queue, canPlay: CanPlay): number {
  for (let i = queue.index - 1; i >= 0; i--) if (canPlay(queue.tracks[i])) return i;
  return -1;
}

/** Advance; null when nothing after the current track can play. */
export function next(queue: Queue, canPlay: CanPlay): Queue | null {
  const index = nextPlayableIndex(queue, queue.index, canPlay);
  return index === -1 ? null : { ...queue, index };
}

export type PreviousStep = { kind: "restart" } | { kind: "move"; queue: Queue };

/** Restart the current track once it has played a moment, otherwise step back past what cannot play. */
export function previous(queue: Queue, currentTime: number, canPlay: CanPlay): PreviousStep {
  const index = previousPlayableIndex(queue, canPlay);
  if (currentTime > RESTART_THRESHOLD_SECONDS || index === -1) return { kind: "restart" };
  return { kind: "move", queue: { ...queue, index } };
}

export type Repeat = "none" | "one";

/** The web repeats one track or nothing (frontend toggleRepeatMode). */
export function toggleRepeat(repeat: Repeat): Repeat {
  return repeat === "one" ? "none" : "one";
}

export type Saved = { queue: Queue; position: number; repeat: Repeat };

const SavedQueue = z.object({
  tracks: z.array(z.unknown()),
  index: z.number().int(),
  tailFrom: z.number().int().optional(),
  tailLabel: z.string().nullable().catch(null),
  position: z.number().nonnegative().catch(0),
  repeat: z.enum(["none", "one"]).catch("none"),
});

/** What a device keeps between launches: the queue, how far into the current track, and repeat. */
export function save({ queue, position, repeat }: Saved): string {
  return JSON.stringify({ tracks: queue.tracks, index: queue.index, tailFrom: queue.tailFrom, tailLabel: queue.tailLabel, position, repeat });
}

/**
 * Read a saved queue back. Stored tracks are checked like any response; when one no longer
 * parses, the entries around it keep their places and the position is kept only if the
 * current track itself survived.
 */
export function restore(text: string | null): Saved | null {
  if (!text) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const saved = SavedQueue.safeParse(body);
  if (!saved.success) return null;

  const kept: Track[] = [];
  let index = -1;
  let tailFrom = 0;
  const boundary = saved.data.tailFrom ?? saved.data.tracks.length;
  saved.data.tracks.forEach((raw, i) => {
    const track = Track.safeParse(raw);
    if (!track.success) return;
    if (i === saved.data.index) index = kept.length;
    if (i < boundary) tailFrom = kept.length + 1;
    kept.push(track.data);
  });
  if (kept.length === 0) return null;
  const survived = index !== -1;
  const queue = make(kept, survived ? index : 0, Math.max(tailFrom, 0), saved.data.tailLabel);
  return { queue, position: survived ? saved.data.position : 0, repeat: saved.data.repeat };
}

/** A drag between rows of a list showing the picks, one divider row, then the tail; `to` is where the row rests. */
export function dragTo(queue: Queue, from: number, to: number): Queue {
  const first = queue.index + 1;
  const picks = upNextEnd(queue) - first;
  const rows = queue.tracks.length - first + 1;
  if (from === picks || from < 0 || from >= rows || to < 0 || to >= rows || from === to) return queue;
  const source = first + (from > picks ? from - 1 : from);
  if (from < picks) return move(queue, source, first + Math.min(to, picks - 1));
  // a list will not open a slot above a divider that is its first row, so with no picks the slot under it promotes too
  if (to === picks || (picks === 0 && to === 1)) return promote(queue, source);
  return move(queue, source, first + (to > picks ? to - 1 : to));
}
