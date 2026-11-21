import { useEffect, useRef } from 'react';
import type { AudioPlayer } from 'expo-audio';
import { attachRemoteTrackControls, type RemoteTrackOwnership } from './remote-track-controls';

export function useRemoteTrackControls(player: AudioPlayer, state: RemoteTrackOwnership) {
  const controls = useRef<ReturnType<typeof attachRemoteTrackControls> | null>(null);
  useEffect(() => {
    const attached = attachRemoteTrackControls(player);
    controls.current = attached;
    return () => { controls.current = null; attached.dispose(); };
  }, [player]);
  useEffect(() => { controls.current?.update(state); });
}
