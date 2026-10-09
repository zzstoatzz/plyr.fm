import { useQueryClient } from "@tanstack/react-query";
import type { Track } from "plyr-shared/contract";
import { playability, playCountThreshold } from "plyr-shared/playback";
import * as Q from "plyr-shared/queue";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Audio, AudioContext, AudioManager, useAudioTagContext, type AudioTagHandle } from "react-native-audio-api";
import { post } from "@/api";
import { fetchAudioUrl } from "@/data";
import { decodes, streams } from "./formats";
import { useNowPlaying } from "./nowPlaying";
import { forget, recall, remember } from "./saved";
import { useUpNextActivity } from "./useUpNextActivity";

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

// per-track state is tagged with its track id, so a new track reads as fresh without resetting in an effect
type Loaded = { trackId: number; uri: string | null };
type Tagged<T> = { trackId: number; value: T };

export function PlayerProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [saved] = useState(recall);
  const [queue, setQueue] = useState<Q.Queue>(saved?.queue ?? Q.EMPTY_QUEUE);
  const [repeat, setRepeat] = useState<Q.Repeat>(saved?.repeat ?? "none");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tag, setTag] = useState<Tagged<TagStatus> | null>(null);
  const [tagged, setProgress] = useState<Tagged<Progress> | null>(() => {
    const restored = saved && Q.current(saved.queue);
    return restored ? { trackId: restored.id, value: { position: saved.position, duration: 0 } } : null;
  });
  const [seeks, setSeeks] = useState(0);
  const [context, setContext] = useState<AudioContext | null>(null);
  const audio = useRef<AudioTagHandle>(null);
  const listened = useRef({ trackId: -1, seconds: 0, last: 0, counted: false });
  // where a restored track picks up once it is first played; cleared when anything else starts
  const resume = useRef(saved && Q.current(saved.queue) ? { trackId: Q.current(saved.queue)?.id ?? -1, position: saved.position } : null);
  const stopAtEnd = useRef(false);
  const started = useRef(false);
  const [attempt, setAttempt] = useState(0);

  const track = Q.current(queue);
  const id = track?.id ?? -1;
  const uri = loaded?.trackId === id ? loaded.uri : null;
  const progress = tagged?.trackId === id ? tagged.value : { position: 0, duration: 0 };
  // no audio context means nothing has been played since launch: a restored queue waits, paused
  const status: Status = !track
    ? "idle"
    : loaded?.trackId !== id
      ? "loading"
      : uri === null
        ? "failed"
        : tag?.trackId === id
          ? tag.value
          : context
            ? "loading"
            : "paused";
  const canNext = Q.hasNext(queue, canPlay);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "default", iosOptions: [] });
  }, []);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    listened.current = { trackId: track.id, seconds: 0, last: 0, counted: false };
    fetchAudioUrl(client, track.file_id).then(
      (url) => !cancelled && setLoaded({ trackId: track.id, uri: url }),
      () => {
        if (cancelled) return;
        setLoaded({ trackId: track.id, uri: null });
        // a queue restored with no network stays where it was; only playback already under way skips ahead
        if (started.current) setQueue((q) => (Q.current(q)?.id === track.id ? (Q.next(q, canPlay) ?? q) : q));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, track, attempt]);

  // the position is saved in ten-second steps and whenever the queue or play state changes
  const step = Math.floor(progress.position / 10);
  const playing = status === "playing" || status === "buffering";
  const persist = useEffectEvent(() => (track ? remember({ queue, position: progress.position, repeat }) : forget()));
  useEffect(() => {
    persist();
  }, [queue, repeat, step, playing]);

  const setStatus = useCallback((value: TagStatus) => setTag({ trackId: id, value }), [id]);

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
      setQueue((q) => Q.playContext(q, tracks, index, label, canPlay) ?? q);
    },
    [begin],
  );

  const queued = useCallback(
    (added: Track, place: (q: Q.Queue, added: Track) => Q.Queue) => {
      if (canPlay(added)) setQueue((q) => place(q, added));
    },
    [],
  );
  const playNext = useCallback((added: Track) => queued(added, Q.playNext), [queued]);
  const addToQueue = useCallback((added: Track) => queued(added, (q, t) => Q.addToQueue(q, [t])), [queued]);

  const jumpTo = useCallback(
    (index: number) => {
      const target = queue.tracks[index];
      if (!target || !canPlay(target)) return;
      begin();
      resume.current = null;
      if (target.id === id) audio.current?.seekToTime(0);
      setQueue((q) => Q.jumpTo(q, index));
    },
    [begin, queue, id],
  );

  const dragTo = useCallback((from: number, to: number) => setQueue((q) => Q.dragTo(q, from, to)), []);
  const remove = useCallback((index: number) => setQueue((q) => Q.remove(q, index)), []);
  const clearUpNext = useCallback(() => setQueue(Q.clearUpNext), []);
  const shuffleUpNext = useCallback(() => setQueue((q) => Q.shuffleUpNext(q)), []);
  const toggleRepeat = useCallback(() => setRepeat(Q.toggleRepeat), []);

  const next = useCallback(() => setQueue((q) => Q.next(q, canPlay) ?? q), []);

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
    const step = Q.previous(queue, progress.position, canPlay);
    if (step.kind === "restart") seek(0);
    else setQueue(step.queue);
  }, [queue, progress.position, seek]);

  const toggle = useCallback(() => {
    if (status === "failed") setAttempt((n) => n + 1);
    if (!context) begin();
    else if (status === "playing" || status === "buffering") audio.current?.pause();
    else audio.current?.play();
  }, [context, status, begin]);

  // a track that breaks moves on rather than dead-airing, as the web player does
  const advanceOr = useCallback(
    (otherwise: TagStatus) => {
      const after = Q.next(queue, canPlay);
      if (after) setQueue(after);
      else setStatus(otherwise);
    },
    [queue, setStatus],
  );

  // the tag starts itself over when a file ends: that is repeat-one, and at the end of the queue it is stopped as it restarts
  const onEnded = useCallback(() => {
    if (repeat === "one") return;
    const after = Q.next(queue, canPlay);
    if (after) return setQueue(after);
    stopAtEnd.current = true;
    setProgress((p) => (p?.trackId === id ? { trackId: id, value: { ...p.value, position: 0 } } : p));
  }, [queue, repeat, id]);

  const onPlay = useCallback(() => {
    if (stopAtEnd.current) {
      stopAtEnd.current = false;
      audio.current?.pause();
      return;
    }
    setStatus("playing");
  }, [setStatus]);

  const onLoad = useCallback(() => {
    // every start of the file is its own listen: repeat-one and a second copy in the queue count again
    listened.current = { trackId: id, seconds: 0, last: 0, counted: false };
    const from = resume.current;
    resume.current = null;
    if (from && from.trackId === id && from.position > 0) seek(from.position);
  }, [id, seek]);

  const onPosition = useCallback(
    (position: number) => {
      setProgress((p) => ({ trackId: id, value: { duration: p?.trackId === id ? p.value.duration : 0, position } }));
      const l = listened.current;
      const step = position - l.last;
      l.last = position;
      if (l.trackId !== id || l.counted || step <= 0 || step > LISTEN_STEP_SECONDS) return;
      l.seconds += step;
      if (progress.duration > 0 && l.seconds >= playCountThreshold(progress.duration)) {
        l.counted = true;
        void post(`/tracks/${id}/play`);
      }
    },
    [id, progress.duration],
  );

  const onDuration = useCallback(
    (duration: number) => setProgress((p) => ({ trackId: id, value: { position: p?.trackId === id ? p.value.position : 0, duration } })),
    [id],
  );

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
  useUpNextActivity(queue, !context || status === "idle" || status === "failed" ? "off" : status === "paused" ? "paused" : "playing", canPlay, jumpTo);

  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  return (
    <ControlsContext.Provider value={controls}>
      <ProgressContext.Provider value={progress}>
        {children}
        {source && context && track ? (
          <Audio
            key={track.id}
            ref={audio}
            source={source}
            context={context}
            autoPlay
            forceDownload={!streams(track.file_type)}
            onLoad={onLoad}
            onPlay={onPlay}
            onPause={() => setStatus("paused")}
            onWaiting={() => setStatus("buffering")}
            onPlaying={() => setStatus("playing")}
            onEnded={onEnded}
            onError={() => advanceOr("failed")}
            onPositionChange={onPosition}
          >
            <DurationProbe onDuration={onDuration} />
          </Audio>
        ) : null}
      </ProgressContext.Provider>
    </ControlsContext.Provider>
  );
}

/** The tag only exposes duration through its context, so a child reads it out. */
function DurationProbe({ onDuration }: { onDuration: (seconds: number) => void }) {
  const { duration } = useAudioTagContext();
  useEffect(() => {
    if (duration > 0) onDuration(duration);
  }, [duration, onDuration]);
  return null;
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
