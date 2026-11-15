import { useEffect, useRef, useState } from 'react';
import { createJamPlayback, type ActiveJam, type JamPlaybackTarget } from '@plyr/next-core/jam-playback';
import { api } from './api-client';
import { openCoordinatorSocket } from './coordinator-origin';

export function useJamPlayback(target: JamPlaybackTarget & { observedPosition: number }, did: string | null) {
  const runtime = useRef(target);
  runtime.current = target;
  const [jam, setJam] = useState<ActiveJam>();
  const model = useRef<ReturnType<typeof createJamPlayback> | null>(null);
  model.current ??= createJamPlayback({
    target: () => runtime.current, did, socket: openCoordinatorSocket, track: api.track, changed: setJam,
  });
  const controller = model.current;
  const playingHere = target.playing();
  useEffect(() => {
    controller.observe();
  }, [controller, jam?.state?.epoch, jam?.state?.occurrence, jam?.state?.playing, jam?.pendingSeekMs, target.ready, target.buffering, target.observedPosition, playingHere]);
  useEffect(() => { controller.setAccount(did); }, [controller, did]);
  useEffect(() => () => { controller.close(); }, [controller]);
  return { ...controller, jam };
}
