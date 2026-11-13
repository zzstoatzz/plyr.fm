import { formatPlaybackEvents, playbackEvents } from './playback-diagnostics';
import { toast } from './toast';

export async function sharePlaybackLog(signedIn: boolean, authReady: boolean) {
  const text = formatPlaybackEvents(playbackEvents(), { platform: 'web', signedIn, authReady });
  try {
    await navigator.clipboard.writeText(text);
    toast.success('playback log copied');
  } catch {
    toast.error('could not copy the playback log');
  }
}
