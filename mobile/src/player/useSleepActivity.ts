import { addUserInteractionListener, type LiveActivity } from "expo-widgets";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import type { Sleep } from "./sleep";
import { SLEEP_CANCEL, SLEEP_EXTEND, sleepActivity, type SleepActivityProps } from "./sleepActivity";

/** A shift in when the track will end smaller than this is playback jitter, not a seek. */
const TRACK_END_SLACK_MS = 2000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

// why the activity is not showing; a store, since it is learned while an effect talks to the system
let problem: string | null = null;
const listeners = new Set<() => void>();
function setProblem(next: string | null) {
  if (next === problem) return;
  problem = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function endAll(): void {
  try {
    for (const live of sleepActivity.getInstances()) void live.end("immediate").catch(() => {});
  } catch {
    // nothing to end where Live Activities are unavailable
  }
}

type Input = {
  sleep: Sleep | null;
  /** Seconds left in the current track, for a timer waiting on its end. */
  trackLeft: number;
  onExtend: () => void;
  onCancel: () => void;
};

/**
 * Shows a running sleep timer as a Live Activity: the countdown in the island and on the lock screen, with more time
 * and cancel. Returns why it could not be shown, or null; the timer itself never depends on it.
 */
export function useSleepActivity({ sleep, trackLeft, onExtend, onCancel }: Input): string | null {
  const activity = useRef<LiveActivity<SleepActivityProps> | null>(null);
  const shown = useRef<SleepActivityProps | null>(null);

  // an activity outlives an app that was killed with a timer running
  useEffect(endAll, []);

  const show = useEffectEvent((props: SleepActivityProps) => {
    const last = shown.current;
    if (last && last.label === props.label && last.startedAt === props.startedAt && Math.abs(last.endsAt - props.endsAt) < TRACK_END_SLACK_MS) return;
    shown.current = props;
    try {
      if (activity.current) {
        void activity.current.update(props).catch((error: unknown) => setProblem(`update failed: ${reason(error)}`));
      } else {
        activity.current = sleepActivity.start(props, "fm.plyr:///player");
        setProblem(null);
      }
    } catch (error) {
      setProblem(`could not start: ${reason(error)}`);
    }
  });

  const hide = useEffectEvent(() => {
    activity.current = null;
    shown.current = null;
    endAll();
  });

  const timed = sleep?.kind === "at" ? sleep : null;
  const untilTrackEnds = sleep?.kind === "track";

  useEffect(() => {
    if (timed) show({ startedAt: timed.startedAt, endsAt: timed.endsAt, label: "sleep timer" });
  }, [timed]);

  useEffect(() => {
    if (!untilTrackEnds || trackLeft <= 0) return;
    const now = Date.now();
    show({ startedAt: shown.current?.label === "until this track ends" ? shown.current.startedAt : now, endsAt: now + trackLeft * 1000, label: "until this track ends" });
  }, [untilTrackEnds, trackLeft]);

  useEffect(() => {
    if (!sleep) hide();
  }, [sleep]);

  const onTap = useEffectEvent((target: string) => {
    if (target === SLEEP_EXTEND) onExtend();
    if (target === SLEEP_CANCEL) onCancel();
  });
  useEffect(() => {
    const taps = addUserInteractionListener((event) => onTap(event.target));
    return () => taps.remove();
  }, []);

  return useSyncExternalStore(subscribe, () => problem);
}
