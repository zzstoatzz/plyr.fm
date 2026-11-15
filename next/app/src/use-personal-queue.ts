import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createPersonalPlayback, type PersonalPlaybackTarget } from '@plyr/next-core/personal-playback';
import { api } from './api-client';
import { useAuth } from './auth';
import { openCoordinatorSocket } from './coordinator-origin';
import { joinPersonalQueue } from './personal-queue-join';
import { registerQueueLogin } from './queue-login';
import { queueStorage } from './queue-storage';

export function usePersonalQueue(target: PersonalPlaybackTarget) {
  const auth = useAuth();
  const runtime = useRef(target);
  runtime.current = target;
  const account = useRef(auth);
  account.current = auth;
  const [model] = useState(() => createPersonalPlayback({
    target: () => runtime.current,
    account: () => {
      const current = account.current;
      return {
        did: current.did,
        ready: current.ready,
        accountSync: current.accountSync,
        join: current.agent ? (client, seed, resume) => joinPersonalQueue(current, client, seed, resume) : undefined,
      };
    },
    storage: queueStorage,
    id: randomUUID,
    resolve: api.resolveTracks,
    recent: (cursor, signal) => api.tracks({ limit: 10, cursor }, signal),
    consumeLogin: () => false,
    socket: openCoordinatorSocket,
  }));
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const { state, remote } = snapshot;
  const [, refreshClock] = useState(0);

  useEffect(() => model.start(), [model, auth.ready, auth.did, auth.agent, auth.accountSync]);
  useEffect(() => { model.save(); }, [model, state, target.repeat, target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);
  useEffect(() => {
    const timer = setInterval(model.tick, 5_000);
    return () => clearInterval(timer);
  }, [model]);
  useEffect(() => registerQueueLogin(model.prepareLogin), [model]);
  useEffect(() => {
    const save = () => model.checkpoint();
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') save(); });
    return () => subscription.remove();
  }, [model]);
  useEffect(() => { model.refresh(); }, [model, target.suspended]);
  useEffect(() => { model.configureContinuation(); }, [model, target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);
  const clockRuns = model.hasRemoteClock();
  useEffect(() => {
    if (!clockRuns) return;
    const timer = setInterval(() => refreshClock(value => value + 1), 250);
    return () => clearInterval(timer);
  }, [clockRuns]);
  useEffect(() => { void model.ensureContinuation(); }, [model, state, target.keepPlaying, target.suspended, remote?.personal?.keepPlaying]);

  return {
    ...model,
    ...snapshot,
    keepPlaying: remote?.personal?.keepPlaying ?? target.keepPlaying,
    deviceOnly: !!auth.did && !auth.accountSync,
  };
}
