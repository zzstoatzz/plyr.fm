import type { AudioEvents, AudioMetadata, AudioPlayer } from 'expo-audio';

export interface RemoteTrackState {
  metadata: AudioMetadata;
  /** Radio: no scrubber, no skipping, the lock screen shows it as live. */
  live?: boolean;
  next?(): void;
  previous?(): void;
}

type RemotePlayer = Pick<AudioPlayer, 'setActiveForLockScreen' | 'clearLockScreenControls'> & {
  addListener(event: 'remoteTrackCommand', listener: AudioEvents['remoteTrackCommand']): { remove(): void };
};

/**
 * `'yielded'`: another player is taking the lock screen. Forget ours without clearing it, since expo-audio's clear can
 * land after the other player's claim and leave the lock screen empty; the claim itself retires ours.
 */
export type RemoteTrackOwnership = RemoteTrackState | 'yielded' | null;

export function attachRemoteTrackControls(player: RemotePlayer) {
  let current: RemoteTrackState | null = null;
  let configured = '';
  const subscription = player.addListener('remoteTrackCommand', event => {
    current?.[event.command]?.();
  });
  return {
    update(next: RemoteTrackOwnership) {
      if (next === 'yielded') { current = null; configured = ''; return; }
      const state = next;
      current = state;
      const key = state ? JSON.stringify([state.metadata, !!state.next, !!state.previous, !!state.live]) : '';
      if (key === configured) return;
      configured = key;
      if (state) player.setActiveForLockScreen(true, state.metadata, {
        showNextTrack: !!state.next, showPreviousTrack: !!state.previous,
        showSeekForward: false, showSeekBackward: false, isLiveStream: !!state.live,
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
