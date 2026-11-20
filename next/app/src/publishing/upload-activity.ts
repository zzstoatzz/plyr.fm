import { Platform } from 'react-native';
import type { UploadIsland } from '@plyr/next-core/publishing/upload-island';
import type { LiveActivity } from 'expo-widgets';
import type { UploadActivityProps } from './UploadActivity';

type Factory = typeof import('./UploadActivity').default;
// A finished upload stays on the Lock Screen briefly; a failure stays long enough to be noticed.
const STALE_MS = 10 * 60_000, DONE_LINGER_MS = 60_000, FAILED_LINGER_MS = 15 * 60_000;
const running = new Map<string, LiveActivity<UploadActivityProps>>();
let factory: Factory | null | undefined;

// Only iOS has Live Activities; a build without the extension just keeps the in-app island.
function activities(): Factory | null {
  if (factory !== undefined) return factory;
  try { factory = Platform.OS === 'ios' ? (require('./UploadActivity') as typeof import('./UploadActivity')).default : null; }
  catch { factory = null; }
  return factory;
}

function props(island: UploadIsland): UploadActivityProps {
  return { title: island.title, summary: island.summary, detail: island.announce, phase: island.phase, progress: island.progress ?? -1 };
}

/** Mirrors an upload step onto the Lock Screen and the Dynamic Island, which stay up while plyr.fm is in the background. */
export function reportUploadActivity(key: string, island: UploadIsland) {
  const live = activities();
  if (!live) return;
  try {
    const current = running.get(key);
    if (island.phase === 'active') {
      if (current) void current.update(props(island), new Date(Date.now() + STALE_MS)).catch(() => undefined);
      else running.set(key, live.start(props(island), 'fm.plyr.next:///upload', new Date(Date.now() + STALE_MS)));
      return;
    }
    if (!current) return;
    running.delete(key);
    void current.end({ after: new Date(Date.now() + (island.phase === 'failed' ? FAILED_LINGER_MS : DONE_LINGER_MS)) }, props(island)).catch(() => undefined);
  } catch {
    // Live Activities can be switched off in Settings; the in-app island still shows the upload.
  }
}

/** Takes down the activity for an upload that left the queue without finishing. */
export function endUploadActivity(key: string) {
  const current = running.get(key);
  if (!current) return;
  running.delete(key);
  void current.end('immediate').catch(() => undefined);
}

/** Ends activities left behind by an earlier launch, whose uploads this process isn't driving. */
export function endOrphanedUploadActivities() {
  const live = activities();
  if (!live) return;
  try {
    const mine = new Set([...running.values()].map(activity => activity.getId()));
    for (const activity of live.getInstances()) if (!mine.has(activity.getId())) void activity.end('immediate').catch(() => undefined);
  } catch { /* nothing to clean up */ }
}
