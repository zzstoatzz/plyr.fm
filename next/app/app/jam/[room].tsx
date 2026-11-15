import { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { P256Keypair } from '@atproto/crypto';
import { api } from '../../src/api-client';
import { login, useAuth } from '../../src/auth';
import { getAuth, type Did } from '../../src/auth-state';
import { Action, Copy, Field, Page } from '../../src/controls';
import { jamSpace, joinJam, type InitialJam } from '../../src/jam-space';
import { coordinatorHeaders } from '../../src/coordinator-origin';
import { usePlayback } from '../../src/playback';
import { initialJam, jamTrack } from '@plyr/next-core/jam-playback';
import { JamNotStarted, parseJamTrackSnapshot } from '@plyr/next-core/jam-space';
import { useResource } from '../../src/CatalogPieces';
import { pdsEndpoint, pdsSupportsSpaces } from '@plyr/next-core/identity';

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
    if (!auth.agent || !auth.did) throw new Error('sign in to join this jam');
    return jamSpace(auth.agent, auth.did, host as Did, key, {
      fetch: (url, init) => fetch(url, init), keypair: () => P256Keypair.create()
    });
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'jam request failed'); }
    finally { setBusy(false); }
  }

  function enter(initial?: InitialJam) {
    const agent = auth.agent;
    player.joinJam({ host, key, admit: async () => {
      const account = getAuth();
      if (account.agent !== agent) throw new Error('account changed');
      try { return await joinJam(account, host as Did, key, initial, coordinatorHeaders); }
      catch (failure) { if (!(failure instanceof JamNotStarted) || !isHost || initial) throw failure; }
      const snapshot = parseJamTrackSnapshot(await client().read());
      const track = await api.track(snapshot.trackId);
      const ref = jamTrack(track, player.current?.id === track.id ? player.status.duration : undefined);
      if (!ref || ref.cid !== snapshot.cid) throw new Error('couldn’t restore the jam’s track.');
      if (getAuth().agent !== agent) throw new Error('account changed');
      return joinJam(account, host as Did, key, { queue: [ref], index: 0, playing: snapshot.playing,
        positionMs: Math.min(ref.durationMs, snapshot.positionMs) }, coordinatorHeaders);
    } });
  }

  async function start() {
    if (player.privatePlayback) throw new Error('play a public track before starting a jam.');
    const current = player.current && (!trackId || player.current.id === trackId) ? player.current : undefined;
    const capture = current && { tracks: player.queue, index: player.index, duration: player.status.duration,
      position: player.status.currentTime, playing: player.status.playing };
    const track = current ?? (trackId ? await api.track(trackId) : undefined);
    const seed = track && initialJam(track, capture);
    if (!seed) throw new Error('couldn’t start a jam with this track.');
    if (getAuth().agent !== auth.agent) return;

    const space = client();
    const created = await space.create();
    if (getAuth().agent !== auth.agent) return;
    const previous = created ? undefined : await space.read(true);
    if (getAuth().agent !== auth.agent) return;
    if (previous !== undefined) { enter(); return; }
    const ref = seed.queue[seed.index];
    await space.publish({ revision: 0, trackId: ref.id, cid: ref.cid, playing: seed.playing,
      positionMs: seed.positionMs, updatedAtMs: Date.now() });
    if (getAuth().agent !== auth.agent) return;
    enter(seed);
    if (capture && seed.queue.length < capture.tracks.length) setNotice('some tracks couldn’t be shared.');
  }

  const link = `/jam/${encodeURIComponent(room ?? '')}${trackId ? `?track=${encodeURIComponent(trackId)}` : ''}`;
  const state = joined ? player.jam?.state : undefined;
  return <Page title="jam room">
    {!auth.ready ? <Copy>checking sign-in…</Copy> : !auth.did ?
      <Action label="Sign in to join" href={`/login?return_to=${encodeURIComponent(link)}`} /> :
      !auth.jamSpace ? <>
        {support.data === undefined && !support.error && <Copy>checking jam support…</Copy>}
        {support.data === false && <Copy>your account’s server doesn’t support jams yet.</Copy>}
        {support.error && <><Copy>couldn’t check jam support.</Copy><Action label="try again" onPress={support.retry} /></>}
        {support.data === true && <>
          <Copy>you’re signed in. allow plyr.fm to create and join jam rooms with this account.</Copy>
          <Action label="Enable Jams" disabled={busy} onPress={() => void run(async () => {
            if (auth.did) await login(auth.did, false, link);
          })} />
        </>}
      </> : !joined && <Action label="Join Jam" disabled={busy} onPress={() => enter()} />}
    {isHost && auth.jamSpace && !joined && <Action label="start jam" disabled={busy || !player.current?.record.cid && !trackId}
      onPress={() => void run(start)} />}
    {joined && <>
      <Copy>{player.jam?.phase === 'connected' ? 'connected' : 'connecting to the jam…'}</Copy>
      {state && <>
        <Action label={state.playing ? 'Pause Jam' : 'Play Jam'} disabled={player.jam?.phase !== 'connected'} onPress={() => player.jamCommand({ action: state.playing ? 'pause' : 'play' })} />
        {isHost ? <Action label="Seek to start" disabled={player.jam?.phase !== 'connected'} onPress={() => player.seek(0)} /> : <Copy>the host controls seeking. everyone can play, pause and edit the queue.</Copy>}
        <Copy>{state.playing ? 'playing' : 'paused'}</Copy>
        {state.playing && !player.status.playing && !player.loading && <Action label="Play audio on this device" onPress={() => player.jamCommand({ action: 'play' })} />}
      </>}
      {isHost && <>
        <Field label="Guest DID" value={guest} onChangeText={setGuest} autoCapitalize="none" />
        <Action label="Invite guest" disabled={busy || !/^did:(plc|web):[^/?#]+$/.test(guest)} onPress={() => void run(async () => {
          await client().invite(guest as Did); setNotice(`share HTTPS://next.plyr.fm${link}`);
        })} />
      </>}
      <Action label="Leave Jam" onPress={player.leaveJam} />
      {!!player.jam?.error && <Copy live>{player.jam.error}</Copy>}
    </>}
    {!!notice && <Copy live>{notice}</Copy>}
    {!!error && <Copy live>{error}</Copy>}
  </Page>;
}
