import { Platform, Share } from 'react-native';
import { formatPlaybackEvents, playbackEvents } from './playback-diagnostics';
import { toast } from './toast';

export async function sharePlaybackLog(signedIn: boolean, authReady: boolean) {
  const text = formatPlaybackEvents(playbackEvents(), { platform: Platform.OS, version: String(Platform.Version), signedIn, authReady });
  try {
    await Share.share({ message: text });
  } catch {
    toast.error('could not share the playback log');
  }
}
