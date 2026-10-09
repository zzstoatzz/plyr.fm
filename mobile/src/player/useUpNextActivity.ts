import type { LiveActivity } from "expo-widgets";
import { credits } from "plyr-shared/format";
import { nextPlayableIndex, type Queue } from "plyr-shared/queue";
import { useEffect, useRef } from "react";
import { canPlay } from "./PlayerProvider";
import { upNextActivity, type UpNextProps } from "./upNextActivity";

/** What the activity says, or null when nothing follows the current track. */
function describe(queue: Queue): UpNextProps | null {
  const at = nextPlayableIndex(queue, queue.index, canPlay);
  const next = queue.tracks[at];
  if (!next) return null;
  const ahead = queue.tracks.slice(at).filter(canPlay).length;
  return { next: next.title, nextBy: credits(next), ahead, from: at >= queue.tailFrom && queue.tailLabel ? `next from: ${queue.tailLabel}` : "" };
}

/** A Live Activity saying what plays next, while something is playing and something follows it. */
export function useUpNextActivity(queue: Queue, playing: boolean) {
  const activity = useRef<LiveActivity<UpNextProps> | null>(null);
  const props = playing ? describe(queue) : null;
  const key = props ? JSON.stringify(props) : null;

  useEffect(() => {
    const live = activity.current;
    if (!props) {
      activity.current = null;
      void live?.end("immediate").catch(() => {});
      return;
    }
    if (live) {
      void live.update(props).catch(() => {});
      return;
    }
    try {
      activity.current = upNextActivity.start(props, "fm.plyr:///queue");
    } catch {
      // Live Activities are off for this app or this device; the queue works without one
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props is rebuilt every render; key is its value
  }, [key]);
}
