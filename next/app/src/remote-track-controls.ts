import type { AudioEvents, AudioMetadata, AudioPlayer } from 'expo-audio';

export interface RemoteTrackState {
  metadata: AudioMetadata;
  next?(): void;
  previous?(): void;
}

type RemotePlayer = Pick<AudioPlayer, 'setActiveForLockScreen' | 'clearLockScreenControls'> & {
  addListener(event: 'remoteTrackCommand', listener: AudioEvents['remoteTrackCommand']): { remove(): void };
};

export function attachRemoteTrackControls(player: RemotePlayer) {
  let current: RemoteTrackState | null = null;
  let configured = '';
  const subscription = player.addListener('remoteTrackCommand', event => {
    current?.[event.command]?.();
  });
  return {
    update(state: RemoteTrackState | null) {
      current = state;
      const key = state ? JSON.stringify([state.metadata, !!state.next, !!state.previous]) : '';
      if (key === configured) return;
      configured = key;
      if (state) player.setActiveForLockScreen(true, state.metadata, {
        showNextTrack: !!state.next, showPreviousTrack: !!state.previous,
        showSeekForward: false, showSeekBackward: false,
      });
      else player.clearLockScreenControls();
    },
    dispose() {
      current = null;
      subscription.remove();
      if (configured) player.clearLockScreenControls();
      configured = '';
    },
  };
}
