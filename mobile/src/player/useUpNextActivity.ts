import { Directory, File } from "expo-file-system";
import { addUserInteractionListener, widgetsDirectory, type LiveActivity } from "expo-widgets";
import type { Track } from "plyr-shared/contract";
import type { Queue } from "plyr-shared/queue";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { timeline } from "./timeline";
import { upNextRows, upNextTarget } from "./upNext";
import { upNextActivity, type UpNextActivityProps } from "./upNextActivity";

const ART = "art-";
const PAUSE_LINGER_MS = 10 * 60 * 1000;

/** "off" until something has been played, and again once nothing can play. */
export type UpNextState = "off" | "playing" | "paused";

function artName(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash * 33) ^ url.charCodeAt(i)) >>> 0;
  return `${ART}${hash.toString(36)}`;
}

const downloads = new Map<string, Promise<string>>();

async function download(url: string): Promise<string> {
  try {
    const file = new File(widgetsDirectory, artName(url));
    return file.exists ? file.uri : (await File.downloadFileAsync(url, file, { idempotent: true })).uri;
  } catch {
    return "";
  }
}

/** The image as a file in the App Group, where the widget extension can read it; "" when there is none. */
function cached(url: string | null): Promise<string> {
  if (!url || !widgetsDirectory) return Promise.resolve("");
  const running = downloads.get(url);
  if (running) return running;
  const started = download(url).finally(() => downloads.delete(url));
  downloads.set(url, started);
  return started;
}

function prune(keep: readonly string[]): void {
  try {
    for (const entry of new Directory(widgetsDirectory).list()) {
      if (entry instanceof File && entry.name.startsWith(ART) && !keep.includes(entry.uri)) entry.delete();
    }
  } catch {
    // a leftover thumbnail costs a few kilobytes
  }
}

function endAll(): void {
  try {
    for (const live of upNextActivity.getInstances()) void live.end("immediate").catch(() => {});
  } catch {
    // Live Activities are off for this app or this device
  }
}

/** A Live Activity listing what plays next; only a foreground app may start one, so it is kept through track changes and pauses. */
export function useUpNextActivity(queue: Queue, state: UpNextState, canPlay: (track: Track) => boolean, jumpTo: (index: number) => void) {
  const activity = useRef<LiveActivity<UpNextActivityProps> | null>(null);
  // swiped away by the listener: it stays away until the queue next has nothing ahead
  const dismissed = useRef(false);
  const [lingered, setLingered] = useState(false);
  const next = state === "off" || lingered ? null : upNextRows(queue, canPlay);
  const key = next ? JSON.stringify(next) : null;

  useEffect(() => {
    if (state !== "paused") return;
    const timer = setTimeout(() => setLingered(true), PAUSE_LINGER_MS);
    return () => {
      clearTimeout(timer);
      setLingered(false);
    };
  }, [state]);

  // an activity outlives an app that was killed mid-playback
  useEffect(endAll, []);

  useEffect(() => {
    if (!next) {
      activity.current = null;
      dismissed.current = false;
      endAll();
      return;
    }
    let stale = false;
    const drawn = next.rows.map(async ({ image, ...row }) => ({ ...row, art: await cached(image) }));
    void Promise.all(drawn).then((rows) => {
      if (stale || dismissed.current) return;
      timeline.mark("activity");
      const props = { rows, more: next.more };
      try {
        if (activity.current) {
          void activity.current.update(props).catch(() => {
            activity.current = null;
            dismissed.current = true;
          });
        } else {
          activity.current = upNextActivity.start(props, "fm.plyr:///queue");
        }
      } catch {
        // Live Activities are off for this app or this device; the queue works without one
      }
      prune(rows.map((row) => row.art));
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- next is rebuilt every render; key is its value
  }, [key]);

  const onTap = useEffectEvent((target: string) => {
    const index = upNextTarget(queue, target);
    if (index !== -1) jumpTo(index);
  });
  useEffect(() => {
    const taps = addUserInteractionListener((event) => onTap(event.target));
    return () => taps.remove();
  }, []);
}
