import { useQueryClient } from "@tanstack/react-query";
import type { Track } from "plyr-shared/contract";
import { playability, playCountThreshold } from "plyr-shared/playback";
import * as Q from "plyr-shared/queue";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AudioContext, AudioManager, type AudioTagHandle } from "react-native-audio-api";
import { post } from "@/api";
import { Deck, type DeckEvent } from "./Deck";
import { decodes } from "./formats";
import { discard, fetchAhead, locate } from "./media";
import { useNowPlaying } from "./nowPlaying";
import { forget, recall, remember } from "./saved";
import { tap } from "./levels";
import { timeline } from "./timeline";

export type Status = "idle" | "loading" | "playing" | "paused" | "buffering" | "failed";
type TagStatus = Exclude<Status, "idle" | "loading">;

export type Controls = {
  queue: Q.Queue;
  track: Track | null;
  status: Status;
  canNext: boolean;
  repeat: Q.Repeat;
  /** Play `tracks` from `index`; the rest follows as "next from: label". */
  playList: (tracks: readonly Track[], index: number, label?: string | null) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  jumpTo: (index: number) => void;
  /** A drag in the queue list: rows are the picks, a divider, then the tail. */
  dragTo: (from: number, to: number) => void;
  remove: (index: number) => void;
  clearUpNext: () => void;
  shuffleUpNext: () => void;
  toggleRepeat: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
};

export type Progress = { position: number; duration: number };

const ControlsContext = createContext<Controls | null>(null);
const ProgressContext = createContext<Progress>({ position: 0, duration: 0 });

export const canPlay = (track: Track) => playability(track, decodes).playable;

/** Largest forward step still counted as listening; anything bigger was a seek. */
const LISTEN_STEP_SECONDS = 2;

/** Seconds of a track heard before the one after it is fetched. */
const AHEAD_AFTER_SECONDS = 1;

// per-track state is tagged with its track id, so a new track reads as fresh without resetting in an effect
type Loaded = { trackId: number; uri: string | null };
type Tagged<T> = { trackId: number; value: T };

/** What the provider knows of a mounted deck; `respawned` marks the reload the tag does by itself when a file ends. */
type Slot = { handle: AudioTagHandle | null; ready: boolean; begun: boolean; respawned: boolean; duration: number };

export function PlayerProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [saved] = useState(recall);
  const [queue, setQueue] = useState<Q.Queue>(saved?.queue ?? Q.EMPTY_QUEUE);
  const [repeat, setRepeat] = useState<Q.Repeat>(saved?.repeat ?? "none");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ahead, setAhead] = useState<Loaded | null>(null);
  const [armed, setArmed] = useState(-1);
  const [tag, setTag] = useState<Tagged<TagStatus> | null>(null);
  const [tagged, setProgress] = useState<Tagged<Progress> | null>(() => {
    const restored = saved && Q.current(saved.queue);
    return restored ? { trackId: restored.id, value: { position: saved.position, duration: 0 } } : null;
  });
  const [seeks, setSeeks] = useState(0);
  const [context, setContext] = useState<AudioContext | null>(null);
  const audio = useRef<AudioTagHandle>(null);
  const slots = useRef(new Map<number, Slot>());
  // the queue and current track as of the last tap, ahead of the render that shows them
  const latest = useRef(queue);
  const active = useRef(Q.current(queue)?.id ?? -1);
  const listened = useRef({ trackId: -1, seconds: 0, last: 0, counted: false });
  // where a restored track picks up once it is first played; cleared when anything else starts
  const resume = useRef(saved && Q.current(saved.queue) ? { trackId: Q.current(saved.queue)?.id ?? -1, position: saved.position } : null);
  const again = useRef(false);
  const started = useRef(false);
  const [attempt, setAttempt] = useState(0);

  const track = Q.current(queue);
  const id = track?.id ?? -1;
  const uri = loaded?.trackId === id ? loaded.uri : ahead?.trackId === id ? ahead.uri : undefined;
  const progress = tagged?.trackId === id ? tagged.value : { position: 0, duration: 0 };
  // no audio context means nothing has been played since launch: a restored queue waits, paused
  const status: Status = !track
    ? "idle"
    : uri === undefined
      ? "loading"
      : uri === null
        ? "failed"
        : tag?.trackId === id
          ? tag.value
          : context
            ? "loading"
            : "paused";
  const canNext = Q.hasNext(queue, canPlay);
  const following = Q.next(queue, canPlay);
  const upcoming = following ? Q.current(following) : null;
  const fetchable = armed === id && upcoming && upcoming.id !== id ? upcoming : null;
  const opened = ahead && upcoming && ahead.trackId === upcoming.id && ahead.trackId !== id ? ahead.uri : null;
  // one keyed list, so the deck opened ahead is the same instance once its track is current
  const decks = [...(uri ? [{ trackId: id, uri }] : []), ...(opened && upcoming ? [{ trackId: upcoming.id, uri: opened }] : [])];

  useEffect(() => {
    AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "default", iosOptions: [] });
  }, []);

  const edit = useCallback((change: (queue: Q.Queue) => Q.Queue) => {
    latest.current = change(latest.current);
    setQueue(latest.current);
  }, []);

  const start = useCallback((trackId: number) => {
    const slot = slots.current.get(trackId);
    if (!slot?.handle || !slot.ready || slot.begun) return;
    slot.begun = true;
    // every start of the file is its own listen: repeat-one and a second copy in the queue count again
    listened.current = { trackId, seconds: 0, last: 0, counted: false };
    const from = resume.current;
    resume.current = null;
    const position = from && from.trackId === trackId ? from.position : 0;
    if (position > 0) slot.handle.seekToTime(position);
    setProgress({ trackId, value: { position, duration: slot.duration } });
    slot.handle.play();
  }, []);

  // called at the tap, not after the render: an opened deck is audible before the screen catches up
  const activate = useCallback(
    (trackId: number) => {
      if (active.current !== trackId) {
        const old = slots.current.get(active.current);
        active.current = trackId;
        audio.current = slots.current.get(trackId)?.handle ?? null;
        if (old) {
          old.begun = false;
          old.handle?.pause();
          old.handle?.seekToTime(0);
        }
      }
      start(trackId);
    },
    [start],
  );

  useEffect(() => {
    activate(id);
  }, [activate, id]);

  const go = useCallback(
    (cause: string, to: Q.Queue | null) => {
      const target = to && Q.current(to);
      if (!to || !target) return;
      timeline.start(cause);
      const replayed = target.id === active.current;
      latest.current = to;
      activate(target.id);
      const slot = slots.current.get(target.id);
      if (replayed && slot?.begun) {
        slot.handle?.seekToTime(0);
        slot.handle?.play();
      }
      if (!slot?.ready) void locate(client, target).catch(() => {});
      setQueue(to);
    },
    [activate, client],
  );

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    timeline.mark("locate:ask");
    locate(client, track).then(
      (found) => {
        timeline.mark("locate:got", `${track.file_type} ${found.startsWith("file:") ? "file" : "url"}`);
        if (!cancelled) setLoaded({ trackId: track.id, uri: found });
      },
      () => {
        if (cancelled) return;
        setLoaded({ trackId: track.id, uri: null });
        // a queue restored with no network stays where it was; only playback already under way skips ahead
        if (started.current) edit((q) => (Q.current(q)?.id === track.id ? (Q.next(q, canPlay) ?? q) : q));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, track, attempt, edit]);

  useEffect(() => {
    if (!fetchable) return;
    let cancelled = false;
    fetchAhead(client, fetchable).then(
      (found) => !cancelled && found && setAhead({ trackId: fetchable.id, uri: found }),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, fetchable]);

  // the position is saved in ten-second steps and whenever the queue or play state changes
  const step = Math.floor(progress.position / 10);
  const playing = status === "playing" || status === "buffering";
  const persist = useEffectEvent(() => (track ? remember({ queue, position: progress.position, repeat }) : forget()));
  useEffect(() => {
    persist();
  }, [queue, repeat, step, playing]);

  // the session is claimed on the first play, not at launch, so opening the app never stops other audio
  const begin = useCallback(() => {
    started.current = true;
    setContext((existing) => existing ?? new AudioContext());
    void AudioManager.setAudioSessionActivity(true).catch(() => {});
  }, []);

  const playList = useCallback(
    (tracks: readonly Track[], index: number, label: string | null = null) => {
      begin();
      resume.current = null;
      go("tap", Q.playContext(latest.current, tracks, index, label, canPlay));
    },
    [begin, go],
  );

  const queued = useCallback(
    (added: Track, place: (q: Q.Queue, added: Track) => Q.Queue) => {
      if (canPlay(added)) edit((q) => place(q, added));
    },
    [edit],
  );
  const playNext = useCallback((added: Track) => queued(added, Q.playNext), [queued]);
  const addToQueue = useCallback((added: Track) => queued(added, (q, t) => Q.addToQueue(q, [t])), [queued]);

  const jumpTo = useCallback(
    (index: number) => {
      const target = latest.current.tracks[index];
      if (!target || !canPlay(target)) return;
      begin();
      resume.current = null;
      go("jump", Q.jumpTo(latest.current, index));
    },
    [begin, go],
  );

  const dragTo = useCallback((from: number, to: number) => edit((q) => Q.dragTo(q, from, to)), [edit]);
  const remove = useCallback((index: number) => edit((q) => Q.remove(q, index)), [edit]);
  const clearUpNext = useCallback(() => edit(Q.clearUpNext), [edit]);
  const shuffleUpNext = useCallback(() => edit((q) => Q.shuffleUpNext(q)), [edit]);
  const toggleRepeat = useCallback(() => setRepeat(Q.toggleRepeat), []);

  const next = useCallback(() => go("next", Q.next(latest.current, canPlay)), [go]);

  const seek = useCallback(
    (seconds: number) => {
      // before anything has played there is no audio to move: the scrubber moves and playback starts from there
      if (!started.current) resume.current = { trackId: id, position: seconds };
      audio.current?.seekToTime(seconds);
      listened.current.last = seconds;
      setProgress((p) => ({ trackId: id, value: { duration: p?.trackId === id ? p.value.duration : 0, position: seconds } }));
      setSeeks((n) => n + 1);
    },
    [id],
  );

  const previous = useCallback(() => {
    const step = Q.previous(latest.current, progress.position, canPlay);
    if (step.kind === "restart") seek(0);
    else go("previous", step.queue);
  }, [progress.position, seek, go]);

  const toggle = useCallback(() => {
    if (status === "failed") setAttempt((n) => n + 1);
    if (!context) begin();
    else if (status === "playing" || status === "buffering") audio.current?.pause();
    else audio.current?.play();
  }, [context, status, begin]);

  const onDeck = (event: DeckEvent) => {
    const { trackId } = event;
    const current = trackId === active.current;
    if (event.kind === "gone") {
      slots.current.delete(trackId);
      if (current) audio.current = null;
      return;
    }
    const slot = slots.current.get(trackId) ?? { handle: null, ready: false, begun: false, respawned: false, duration: 0 };
    slots.current.set(trackId, slot);
    switch (event.kind) {
      case "handle":
        slot.handle = event.handle;
        if (current) audio.current = event.handle;
        return;
      case "duration":
        slot.duration = event.seconds;
        if (current) setProgress((p) => ({ trackId, value: { position: p?.trackId === trackId ? p.value.position : 0, duration: event.seconds } }));
        return;
      case "ready": {
        if (context && slot.handle) tap(context, slot.handle);
        const respawned = slot.respawned;
        slot.respawned = false;
        slot.ready = true;
        if (!respawned) timeline.mark("opened", current ? "" : "ahead");
        if (!current) return;
        if (!respawned) return start(trackId);
        slot.begun = false;
        // started a tick later: in the same batch the tag would still be reporting the old source's position
        if (again.current) setTimeout(() => active.current === trackId && start(trackId), 0);
        else setTag({ trackId, value: "paused" });
        again.current = false;
        return;
      }
      case "ended": {
        slot.respawned = true;
        if (!current) return;
        again.current = repeat === "one";
        if (again.current) return;
        const after = Q.next(latest.current, canPlay);
        if (after) go("ended", after);
        else setProgress((p) => (p?.trackId === trackId ? { trackId, value: { ...p.value, position: 0 } } : p));
        return;
      }
      case "error": {
        if (track?.id === trackId) discard(track);
        if (!current) return setAhead((a) => (a?.trackId === trackId ? null : a));
        // a track that breaks moves on rather than dead-airing, as the web player does
        const after = Q.next(latest.current, canPlay);
        if (after) go("error", after);
        else setTag({ trackId, value: "failed" });
        return;
      }
      case "play":
        if (current) timeline.mark("play");
        if (current) setTag({ trackId, value: "playing" });
        return;
      case "pause":
        if (current) setTag({ trackId, value: "paused" });
        return;
      case "waiting":
        if (current) setTag({ trackId, value: "buffering" });
        return;
      case "playing":
        if (current) setTag({ trackId, value: "playing" });
        return;
      case "position": {
        if (!current) return;
        const position = event.seconds;
        timeline.position(position);
        if (position >= AHEAD_AFTER_SECONDS) setArmed(trackId);
        setProgress((p) => ({ trackId, value: { duration: p?.trackId === trackId ? p.value.duration : slot.duration, position } }));
        const l = listened.current;
        const step = position - l.last;
        l.last = position;
        if (l.trackId !== trackId || l.counted || step <= 0 || step > LISTEN_STEP_SECONDS) return;
        l.seconds += step;
        if (slot.duration > 0 && l.seconds >= playCountThreshold(slot.duration)) {
          l.counted = true;
          void post(`/tracks/${trackId}/play`);
        }
        return;
      }
    }
  };
  // decks hold one stable callback, so a preloaded deck is not re-rendered or reloaded while it waits
  const deliver = useRef(onDeck);
  useEffect(() => {
    deliver.current = onDeck;
  });
  const on = useCallback((event: DeckEvent) => deliver.current(event), []);

  const controls = useMemo<Controls>(
    () => ({
      queue,
      track,
      status,
      canNext,
      repeat,
      playList,
      playNext,
      addToQueue,
      jumpTo,
      dragTo,
      remove,
      clearUpNext,
      shuffleUpNext,
      toggleRepeat,
      toggle,
      next,
      previous,
      seek,
    }),
    [queue, track, status, canNext, repeat, playList, playNext, addToQueue, jumpTo, dragTo, remove, clearUpNext, shuffleUpNext, toggleRepeat, toggle, next, previous, seek],
  );

  useNowPlaying({ controls, progress, seeks, audio });
  useInterruptions(audio, playing);

  return (
    <ControlsContext.Provider value={controls}>
      <ProgressContext.Provider value={progress}>
        {children}
        {context ? decks.map((deck) => <Deck key={deck.trackId} trackId={deck.trackId} uri={deck.uri} context={context} on={on} />) : null}
      </ProgressContext.Provider>
    </ControlsContext.Provider>
  );
}

/** Pause for calls and Siri, resume when iOS says to, and pause when headphones are pulled. */
function useInterruptions(audio: RefObject<AudioTagHandle | null>, playing: boolean) {
  const wasPlaying = useRef(false);
  useEffect(() => {
    wasPlaying.current = playing;
  }, [playing]);
  useEffect(() => {
    AudioManager.observeAudioInterruptions(true);
    let resumable = false;
    const interruption = AudioManager.addSystemEventListener("interruption", ({ type, shouldResume }) => {
      if (type === "began") {
        resumable = wasPlaying.current;
        audio.current?.pause();
      } else if (shouldResume && resumable) {
        audio.current?.play();
      }
    });
    const route = AudioManager.addSystemEventListener("routeChange", ({ reason }) => {
      if (reason === "OldDeviceUnavailable") audio.current?.pause();
    });
    return () => {
      interruption.remove();
      route.remove();
      AudioManager.observeAudioInterruptions(false);
    };
  }, [audio]);
}

export function usePlayer(): Controls {
  const value = useContext(ControlsContext);
  if (!value) throw new Error("usePlayer outside PlayerProvider");
  return value;
}

export function useProgress(): Progress {
  return useContext(ProgressContext);
}
