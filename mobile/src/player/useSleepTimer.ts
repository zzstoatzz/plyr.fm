import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from "react";
import type { AudioTagHandle } from "react-native-audio-api";
import { useSleepActivity } from "./useSleepActivity";
import { extended, FADE_MS, SLEEP_EXTENSION_MINUTES, sleepIn, sleepVolume, type Sleep } from "./sleep";

const FADE_STEP_MS = 250;

export type SleepControls = {
  sleep: Sleep | null;
  sleepAfter: (minutes: number) => void;
  sleepAtTrackEnd: () => void;
  extendSleep: () => void;
  cancelSleep: () => void;
  /** Why the timer's Live Activity is not showing, when it is not. */
  activityProblem: string | null;
};

export const SleepContext = createContext<SleepControls | null>(null);

export function useSleep(): SleepControls {
  const value = useContext(SleepContext);
  if (!value) throw new Error("useSleep needs a PlayerProvider above it");
  return value;
}

/**
 * Runs the sleep timer against the current deck: fades it out and pauses at the end of a timed sleep.
 * `takeTrackEnd` is for the deck's ended event: true once, when the timer was waiting for that.
 */
export function useSleepTimer(audio: RefObject<AudioTagHandle | null>, trackLeft: number) {
  const [sleep, setSleep] = useState<Sleep | null>(null);
  const current = useRef(sleep);
  useEffect(() => {
    current.current = sleep;
  }, [sleep]);

  // whichever deck is current when the timer stops, not the one it started on
  const fullVolume = useEffectEvent(() => audio.current?.setVolume(1));

  useEffect(() => {
    if (sleep?.kind !== "at") return;
    let fade: ReturnType<typeof setInterval> | null = null;
    const step = () => {
      const volume = sleepVolume(sleep, Date.now());
      audio.current?.setVolume(volume);
      if (volume > 0) return;
      audio.current?.pause();
      audio.current?.setVolume(1);
      setSleep(null);
    };
    const wait = setTimeout(
      () => {
        step();
        fade = setInterval(step, FADE_STEP_MS);
      },
      Math.max(0, sleep.endsAt - FADE_MS - Date.now()),
    );
    return () => {
      clearTimeout(wait);
      if (fade) clearInterval(fade);
      fullVolume();
    };
  }, [sleep, audio]);

  const [actions] = useState(() => ({
    sleepAfter: (minutes: number) => setSleep(sleepIn(minutes, Date.now())),
    sleepAtTrackEnd: () => setSleep({ kind: "track" }),
    extendSleep: () => setSleep((running) => (running ? extended(running, SLEEP_EXTENSION_MINUTES, Date.now()) : running)),
    cancelSleep: () => setSleep(null),
  }));
  const activityProblem = useSleepActivity({ sleep, trackLeft, onExtend: actions.extendSleep, onCancel: actions.cancelSleep });
  const controls = useMemo<SleepControls>(() => ({ sleep, ...actions, activityProblem }), [sleep, actions, activityProblem]);

  const takeTrackEnd = () => {
    if (current.current?.kind !== "track") return false;
    setSleep(null);
    return true;
  };

  return { controls, takeTrackEnd };
}
