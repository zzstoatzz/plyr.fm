import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { P256Keypair } from '@atproto/crypto';
import { api, type Track } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { Did } from '../../src/auth-state';
import { Action, Copy, Field, Page } from '../../src/controls';
import { jamSpace } from '../../src/jam-space';
import { usePlayback } from '../../src/playback';

interface Snapshot {
  revision: number;
  trackId: string;
  cid: string;
  playing: boolean;
  positionMs: number;
  updatedAtMs: number;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<Snapshot>;
  return typeof state.trackId === 'string' && typeof state.cid === 'string'
    && typeof state.playing === 'boolean'
    && [state.revision, state.positionMs, state.updatedAtMs].every(n => Number.isSafeInteger(n) && Number(n) >= 0);
}

export default function JamRoom() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const auth = useAuth();
  const player = usePlayback();
  const playback = useRef(player);
  playback.current = player;
  const [host, key] = (room ?? '').split('~');
  const isHost = auth.did === host;
  const [joined, setJoined] = useState(false);
  const [guest, setGuest] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  function client() {
    if (!auth.agent || !auth.did) throw new Error('Sign in to join this Jam');
    return jamSpace(auth.agent, auth.did, host as Did, key, {
      fetch: (url, init) => fetch(url, init),
      keypair: () => P256Keypair.create()
    });
  }

  useEffect(() => {
    if (!joined || !auth.agent) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let track: Track | undefined;
    let revision = -1;
    async function poll() {
      try {
        const state = await client().read();
        if (!isSnapshot(state)) throw new Error('Invalid Jam playback state');
        if (state.revision < revision) return;
        if (track?.id !== state.trackId || track.record.cid !== state.cid) track = await api.track(state.trackId);
        if (track.record.cid !== state.cid) throw new Error('The Jam track has changed');
        if (!active) return;
        revision = state.revision;
        setSnapshot(state);
        const elapsed = state.playing ? Math.max(0, Date.now() - state.updatedAtMs) : 0;
        await playback.current.syncJam(track, (state.positionMs + elapsed) / 1000, state.playing);
        if (active) setError('');
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not join this Jam');
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      playback.current.leaveJam();
    };
  }, [auth.agent, room, joined]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Jam request failed'); }
    finally { setBusy(false); }
  }

  async function update(playing: boolean, positionMs: number) {
    if (!snapshot) return;
    await client().publish({
      ...snapshot, revision: snapshot.revision + 1, playing, positionMs, updatedAtMs: Date.now()
    });
  }

  const link = `/jam/${encodeURIComponent(room ?? '')}`;
  return <Page title="Jam room">
    {!auth.ready ? <Copy>Checking sign-in…</Copy> : (!auth.did || !auth.jamSpace) ?
      <Action label="Sign in to join" href={`/login?return_to=${encodeURIComponent(link)}`} /> :
      !joined && <Action label="Join Jam" onPress={() => setJoined(true)} />}
    {isHost && auth.jamSpace && !joined && <Action label="Create Jam with current track" disabled={busy || !player.current?.record.cid}
      onPress={() => void run(async () => {
        const track = player.current;
        if (!track?.record.cid) return;
        const space = client();
        await space.create();
        await space.publish({ revision: 0, trackId: track.id, cid: track.record.cid, playing: false, positionMs: 0, updatedAtMs: Date.now() });
        setJoined(true);
      })} />}
    {joined && isHost && <>
      <Field label="Guest DID" value={guest} onChangeText={setGuest} autoCapitalize="none" />
      <Action label="Invite guest" disabled={busy || !/^did:(plc|web):[^/?#]+$/.test(guest)}
        onPress={() => void run(async () => {
          await client().invite(guest as Did);
          setNotice(`Share https://next.plyr.fm${link}`);
        })} />
      {snapshot && <>
        <Action label={snapshot.playing ? 'Pause Jam' : 'Play Jam'} disabled={busy}
          onPress={() => void run(() => update(!snapshot.playing, Math.round(player.status.currentTime * 1000)))} />
        <Action label="Seek to start" disabled={busy} onPress={() => void run(() => update(snapshot.playing, 0))} />
      </>}
    </>}
    {joined && snapshot && <Copy>{snapshot.playing ? 'Playing' : 'Paused'}</Copy>}
    {!!notice && <Copy>{notice}</Copy>}
    {!!error && <Copy>{error}</Copy>}
  </Page>;
}
