import { useQueryClient } from "@tanstack/react-query";
import type { Track } from "plyr-shared/contract";
import { playability, playCountThreshold } from "plyr-shared/playback";
import * as Q from "plyr-shared/queue";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Audio, AudioContext, AudioManager, useAudioTagContext, type AudioTagHandle } from "react-native-audio-api";
import { post } from "@/api";
import { fetchAudioUrl } from "@/data";
import { decodes } from "./formats";
import { useNowPlaying } from "./nowPlaying";

export type Status = "idle" | "loading" | "playing" | "paused" | "buffering" | "failed";
type TagStatus = Exclude<Status, "idle" | "loading">;

export type Controls = {
  queue: Q.Queue;
  track: Track | null;
  status: Status;
  canNext: boolean;
  /** Play `tracks` from `index`, queuing the rest of the list after it. */
  playList: (tracks: readonly Track[], index: number) => void;
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
  const [queue, setQueue] = useState<Q.Queue>(Q.EMPTY_QUEUE);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tag, setTag] = useState<Tagged<TagStatus> | null>(null);
  const [tagged, setProgress] = useState<Tagged<Progress> | null>(null);
  const [seeks, setSeeks] = useState(0);
  const [context, setContext] = useState<AudioContext | null>(null);
  const audio = useRef<AudioTagHandle>(null);
  const listened = useRef({ trackId: -1, seconds: 0, last: 0, counted: false });

  const track = Q.current(queue);
  const id = track?.id ?? -1;
  const uri = loaded?.trackId === id ? loaded.uri : null;
  const progress = tagged?.trackId === id ? tagged.value : { position: 0, duration: 0 };
  const status: Status = !track
    ? "idle"
    : loaded?.trackId !== id
      ? "loading"
      : uri === null
        ? "failed"
        : tag?.trackId === id
          ? tag.value
          : "loading";
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
        setQueue((q) => (Q.current(q)?.id === track.id ? (Q.next(q, canPlay) ?? q) : q));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, track]);

  const setStatus = useCallback((value: TagStatus) => setTag({ trackId: id, value }), [id]);

  const playList = useCallback((tracks: readonly Track[], index: number) => {
    // the session is claimed on the first play, not at launch, so opening the app never stops other audio
    setContext((existing) => existing ?? new AudioContext());
    void AudioManager.setAudioSessionActivity(true).catch(() => {});
    setQueue(Q.start(tracks, index, canPlay));
  }, []);

  const next = useCallback(() => setQueue((q) => Q.next(q, canPlay) ?? q), []);

  const seek = useCallback((seconds: number) => {
    audio.current?.seekToTime(seconds);
    listened.current.last = seconds;
    setSeeks((n) => n + 1);
  }, []);

  const previous = useCallback(() => {
    const step = Q.previous(queue, progress.position, canPlay);
    if (step.kind === "restart") seek(0);
    else setQueue(step.queue);
  }, [queue, progress.position, seek]);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "buffering") audio.current?.pause();
    else audio.current?.play();
  }, [status]);

  // a track that ends or breaks moves on rather than dead-airing, as the web player does
  const advanceOr = useCallback(
    (otherwise: TagStatus) => {
      const after = Q.next(queue, canPlay);
      if (after) setQueue(after);
      else setStatus(otherwise);
    },
    [queue, setStatus],
  );

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
    () => ({ queue, track, status, canNext, playList, toggle, next, previous, seek }),
    [queue, track, status, canNext, playList, toggle, next, previous, seek],
  );

  useNowPlaying({ controls, progress, seeks, audio });
  useInterruptions(audio, status === "playing" || status === "buffering");

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
            onPlay={() => setStatus("playing")}
            onPause={() => setStatus("paused")}
            onWaiting={() => setStatus("buffering")}
            onPlaying={() => setStatus("playing")}
            onEnded={() => advanceOr("paused")}
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
