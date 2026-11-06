import { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { P256Keypair } from '@atproto/crypto';
import { api } from '../../src/api';
import { login, useAuth } from '../../src/auth';
import { getAuth, type Did } from '../../src/auth-state';
import { Action, Copy, Field, Page } from '../../src/controls';
import { jamSpace, joinJam, type InitialJam } from '../../src/jam-space';
import { usePlayback } from '../../src/playback';
import { jamTrack } from '../../src/use-jam-playback';
import { useResource } from '../../src/CatalogPieces';
import { pdsEndpoint, pdsSupportsSpaces } from '../../src/identity';

function legacyTrack(value: unknown): { trackId: string; cid: string; playing: boolean; positionMs: number } {
  if (!value || typeof value !== 'object') throw new Error('Could not read this Jam');
  const record = value as Record<string, unknown>;
  if (typeof record.trackId !== 'string' || typeof record.cid !== 'string' || typeof record.playing !== 'boolean'
      || typeof record.positionMs !== 'number' || !Number.isSafeInteger(record.positionMs) || record.positionMs < 0) throw new Error('Could not read this Jam');
  return { trackId: record.trackId, cid: record.cid, playing: record.playing, positionMs: record.positionMs };
}

export default function JamRoom() {
  const { room, track: trackId } = useLocalSearchParams<{ room: string; track?: string }>();
  const auth = useAuth();
  const player = usePlayback();
  const [host, key] = (room ?? '').split('~');
  const isHost = auth.did === host;
  const joined = player.jam?.host === host && player.jam.key === key;
  const [guest, setGuest] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const checkSupport = useCallback(async () => auth.did && !auth.jamSpace
    ? pdsSupportsSpaces(await pdsEndpoint(auth.did)) : true, [auth.did, auth.jamSpace]);
  const support = useResource(checkSupport);

  function client() {
    if (!auth.agent || !auth.did) throw new Error('Sign in to join this Jam');
    return jamSpace(auth.agent, auth.did, host as Did, key, {
      fetch: (url, init) => fetch(url, init), keypair: () => P256Keypair.create()
    });
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Jam request failed'); }
    finally { setBusy(false); }
  }

  async function enter(initial?: InitialJam) {
    if (isHost && !initial) {
      const snapshot = legacyTrack(await client().read());
      const track = await api.track(snapshot.trackId);
      const ref = jamTrack(track, player.current?.id === track.id ? player.status.duration : undefined);
      if (!ref || ref.cid !== snapshot.cid) throw new Error('The Jam track has changed');
      initial = { queue: [ref], index: 0, playing: snapshot.playing, positionMs: Math.min(ref.durationMs, snapshot.positionMs) };
    }
    const start = initial;
    player.joinJam({ host, key, admit: () => joinJam(getAuth(), host as Did, key, start) });
  }

  const link = `/jam/${encodeURIComponent(room ?? '')}${trackId ? `?track=${encodeURIComponent(trackId)}` : ''}`;
  const state = joined ? player.jam?.state : undefined;
  return <Page title="Jam room">
    {!auth.ready ? <Copy>Checking sign-in…</Copy> : !auth.did ?
      <Action label="Sign in to join" href={`/login?return_to=${encodeURIComponent(link)}`} /> :
      !auth.jamSpace ? <>
        {support.data === undefined && !support.error && <Copy>Checking Jam support…</Copy>}
        {support.data === false && <Copy>Your account’s server doesn’t support Jams yet.</Copy>}
        {support.error && <><Copy>Couldn’t check Jam support.</Copy><Action label="try again" onPress={support.retry} /></>}
        {support.data === true && <>
          <Copy>You’re signed in. Allow plyr.fm to create and join Jam rooms with this account.</Copy>
          <Action label="Enable Jams" disabled={busy} onPress={() => void run(async () => {
            if (auth.did) await login(auth.did, false, link);
          })} />
        </>}
      </> : !joined && <Action label="Join Jam" disabled={busy} onPress={() => void run(() => enter())} />}
    {isHost && auth.jamSpace && !joined && <Action label="Create Jam with current track" disabled={busy || !player.current?.record.cid && !trackId}
      onPress={() => void run(async () => {
        const track = player.current ?? (trackId ? await api.track(trackId) : undefined);
        const ref = track ? jamTrack(track, player.current?.id === track.id ? player.status.duration : undefined) : undefined;
        if (!track || !ref) throw new Error('Choose a track with audio before starting a Jam');
        const space = client();
        await space.create();
        await space.publish({ revision: 0, trackId: track.id, cid: ref.cid, playing: false, positionMs: 0, updatedAtMs: Date.now() });
        await enter({ queue: [ref], index: 0, playing: false, positionMs: 0 });
      })} />}
    {joined && <>
      <Copy>{player.jam?.phase === 'connected' ? 'Connected' : 'Connecting to the Jam…'}</Copy>
      {state && <>
        <Action label={state.playing ? 'Pause Jam' : 'Play Jam'} disabled={player.jam?.phase !== 'connected'} onPress={() => player.jamCommand({ action: state.playing ? 'pause' : 'play' })} />
        {isHost ? <Action label="Seek to start" disabled={player.jam?.phase !== 'connected'} onPress={() => player.seek(0)} /> : <Copy>The host controls seeking. Everyone can play, pause and edit the queue.</Copy>}
        <Copy>{state.playing ? 'Playing' : 'Paused'}</Copy>
        {state.playing && !player.status.playing && !player.loading && <Action label="Play audio on this device" onPress={() => player.jamCommand({ action: 'play' })} />}
      </>}
      {isHost && <>
        <Field label="Guest DID" value={guest} onChangeText={setGuest} autoCapitalize="none" />
        <Action label="Invite guest" disabled={busy || !/^did:(plc|web):[^/?#]+$/.test(guest)} onPress={() => void run(async () => {
          await client().invite(guest as Did); setNotice(`Share https://next.plyr.fm${link}`);
        })} />
      </>}
      <Action label="Leave Jam" onPress={player.leaveJam} />
      {!!player.jam?.error && <Copy live>{player.jam.error}</Copy>}
    </>}
    {!!notice && <Copy live>{notice}</Copy>}
    {!!error && <Copy live>{error}</Copy>}
  </Page>;
}
