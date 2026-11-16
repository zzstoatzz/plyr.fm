import type { Track } from '@plyr/next-core/api';
import { canToggleTrack } from '@plyr/next-core/track-revision';
import { usePlayback } from './playback-context';

export function useTrackPlayback(track: Track) {
  const player = usePlayback();
  const current = canToggleTrack(player.current, track, !!player.jam);
  const playing = current && player.status.playing;
  return {
    current,
    playing,
    toggle: (start: () => void) => current ? player.setPlaying(!playing) : start()
  };
}
