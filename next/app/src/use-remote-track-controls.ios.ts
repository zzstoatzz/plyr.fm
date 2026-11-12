import { useEffect, useRef } from 'react';
import type { AudioPlayer } from 'expo-audio';
import { attachRemoteTrackControls, type RemoteTrackState } from './remote-track-controls';

export function useRemoteTrackControls(player: AudioPlayer, state: RemoteTrackState | null) {
  const controls = useRef<ReturnType<typeof attachRemoteTrackControls> | null>(null);
  useEffect(() => {
    const attached = attachRemoteTrackControls(player);
    controls.current = attached;
    return () => { controls.current = null; attached.dispose(); };
  }, [player]);
  useEffect(() => { controls.current?.update(state); });
}
