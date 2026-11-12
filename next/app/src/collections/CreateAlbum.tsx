import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { albumIdFromUri, type Track } from '../api';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { createPds } from '../pds';
import { Action, Copy, Field, Page, row } from '../controls';
import { errorMessage, Status } from '../CatalogPieces';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from '../publishing/CreateRecovery';
import { AlbumTracks, OwnAlbumTracks } from './AlbumTracks';

export default function CreateAlbum() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="new album">
    {!auth.ready ? <Status loading /> : !auth.did ? <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/create-album' } }} />
      : <AlbumDraft key={`${auth.did}:${session.version}`} auth={auth} did={auth.did} />}
  </Page>;
}

function AlbumDraft({ auth, did }: { auth: Auth; did: string }) {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const recovery = useCreateRecovery(auth, 'album');
  const [name, setName] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const live = useRef(true), locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const blocked = busy || recovery.loading || !!recovery.error || !!recovery.operations.length || !!created;
  async function create() {
    if (blocked || locked.current || !current()) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      const result = await pds.albumOrganization().create(name, tracks);
      if (current()) setCreated(result.uri);
    } catch (error) { if (current()) setError(errorMessage(error)); }
    finally { await recovery.refresh(); locked.current = false; if (current()) setBusy(false); }
  }
  return <View style={{ gap: 16 }}>
    <Copy>choose your published tracks, then arrange the album.</Copy>
    <CreateRecovery auth={auth} recovery={recovery} kind="album" onDismiss={() => { setCreated(undefined); setName(''); setTracks([]); setError(undefined); }} />
    <EarlierCreates auth={auth} recovery={recovery} kind="album" />
    <Field label="Album name" value={name} onChangeText={setName} maxLength={64} editable={!blocked} />
    <AlbumTracks entries={tracks.map(track => ({ key: track.record.uri, title: track.metadata.title }))} disabled={blocked}
      move={(index, target) => setTracks(value => { const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; return next; })}
      remove={index => setTracks(value => value.filter((_, position) => index !== position))} />
    <Status loading={busy} error={error} />
    <View style={row}><Action primary label="Create album" disabled={blocked || !name.trim() || !tracks.length} onPress={() => void create()} /></View>
    {created && !recovery.operations.length && <Action label="Open created album" href={`/album/${albumIdFromUri(created)}`} />}
    <OwnAlbumTracks did={did} selected={tracks.map(track => track.record.uri)} disabled={blocked || tracks.length >= 500} add={track => setTracks(value => [...value, track])} />
  </View>;
}
