import type { AudioPlayer } from 'expo-audio';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { ListeningSession } from './listening-session';
import { playOutbox } from './play-reporting';

export function usePlayerAccounting(player: AudioPlayer) {
  const accounting = useMemo(() => {
    const session = new ListeningSession();
    let token: number | undefined;
    let subscription: { remove(): void } | undefined;
    let source: { trackId: string; duration?: number | null } | undefined;
    let previous = 0;
    let seeking = false;
    let seekGeneration = 0;

    function stop() {
      seekGeneration++;
      seeking = false;
      subscription?.remove();
      subscription = undefined;
      session.stop();
      token = undefined;
      source = undefined;
    }

    function begin(trackId: string, duration?: number | null) {
      stop();
      source = { trackId, duration };
      token = session.begin(trackId, randomUUID(), duration ?? undefined);
      previous = 0;
      subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (token === undefined || !source) return;
        const position = player.currentTime;
        const duration = player.duration || source.duration || 0;
        const boundary = Math.min(1, duration / 4);
        if (!seeking && player.loop && duration > 0 && position < previous && previous >= duration - boundary && position < boundary) {
          token = session.begin(source.trackId, randomUUID(), duration);
        }
        previous = position;
        const qualified = session.observe(token, {
          positionSeconds: position,
          durationSeconds: duration,
          playing: player.playing && player.isLoaded && !status.error && !status.didJustFinish && !status.isLive,
          buffering: status.isBuffering,
          monotonicMs: performance.now(),
          playbackRate: status.playbackRate,
        });
        if (qualified) {
          console.info('[plays] qualified', { track: qualified.trackId, occurrence: qualified.occurrenceId });
          playOutbox().enqueue(qualified);
        }
      });
    }

    async function seekTo(position: number) {
      const current = token;
      if (current !== undefined) session.discontinue(current);
      const request = ++seekGeneration;
      seeking = true;
      try {
        await player.seekTo(position);
      } finally {
        if (request === seekGeneration) {
          seeking = false;
          previous = player.currentTime;
          if (current !== undefined && current === token) session.settle(current);
        }
      }
    }

    return { begin, stop, seekTo };
  }, [player]);

  useEffect(() => {
    const outbox = playOutbox();
    outbox.retry();
    const active = AppState.addEventListener('change', state => { if (state === 'active') outbox.retry(); });
    const online = () => outbox.retry();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      active.remove();
      if (Platform.OS === 'web') window.removeEventListener('online', online);
      accounting.stop();
    };
  }, [accounting]);
  return accounting;
}
