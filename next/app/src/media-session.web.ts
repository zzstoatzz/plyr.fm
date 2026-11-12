import { useEffect } from 'react';
import type { MediaSessionState } from './media-session';

export type { MediaSessionState } from './media-session';

const owners: { player?: MediaSessionState; radio?: MediaSessionState } = {};
const actions: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'];
let described = '';
let wired = '';

function handle(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
}

function apply() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  const state = owners.radio ?? owners.player;
  if (!state) {
    if (!described && !wired) return;
    described = '';
    wired = '';
    session.metadata = null;
    session.playbackState = 'none';
    for (const action of actions) handle(action, null);
    try { session.setPositionState(); } catch { /* unsupported */ }
    return;
  }
  const key = JSON.stringify([state.title, state.artist, state.album, state.artwork]);
  if (key !== described) {
    described = key;
    session.metadata = new MediaMetadata({ title: state.title, artist: state.artist, album: state.album ?? '',
      artwork: state.artwork ? [{ src: state.artwork, sizes: '512x512' }] : [] });
  }
  session.playbackState = state.playing ? 'playing' : 'paused';
  const current = () => owners.radio ?? owners.player;
  const available = [true, true, !!state.previous, !!state.next, !!state.seek, !!state.skip, !!state.skip].join();
  if (available !== wired) {
    wired = available;
    handle('play', () => current()?.play());
    handle('pause', () => current()?.pause());
    handle('previoustrack', state.previous ? () => current()?.previous?.() : null);
    handle('nexttrack', state.next ? () => current()?.next?.() : null);
    handle('seekto', state.seek ? details => { if (details.seekTime !== undefined) current()?.seek?.(details.seekTime); } : null);
    handle('seekbackward', state.skip ? details => current()?.skip?.(-(details.seekOffset ?? 15)) : null);
    handle('seekforward', state.skip ? details => current()?.skip?.(details.seekOffset ?? 15) : null);
  }
  try {
    if (state.duration && Number.isFinite(state.duration) && state.duration > 0) {
      session.setPositionState({ duration: state.duration, playbackRate: 1, position: Math.max(0, Math.min(state.position ?? 0, state.duration)) });
    } else session.setPositionState();
  } catch { /* stale position during a track change */ }
}

export function useMediaSession(owner: 'player' | 'radio', state: MediaSessionState | null) {
  useEffect(() => {
    if (state) owners[owner] = state; else delete owners[owner];
    apply();
  });
  useEffect(() => () => { delete owners[owner]; apply(); }, [owner]);
}
