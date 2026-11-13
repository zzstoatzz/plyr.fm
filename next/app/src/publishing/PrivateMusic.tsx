import { PrivateTrackDelete } from './PrivateTrackDelete';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import type { Track } from '../api';
import type { MediaFile } from '../pds';
import { Action, Copy, Field, Page } from '../controls';
import { Heading } from '../CatalogPieces';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { usePlayback } from '../playback';
import { TagsField } from './TagsField';
import { privatePds, type PrivateResult } from './private-pds';
import type { PrivateCreate } from './private-create';

export default function PrivateMusic() {
  const auth = useAuth(), [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="just for you">
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/private' } }} />
      : <AccountPrivateMusic key={`${auth.did}:${session.version}`} auth={auth} />}
  </Page>;
}

function AccountPrivateMusic({ auth }: { auth: Auth }) {
  const pds = useMemo(() => privatePds(auth), [auth.did, auth.rpc]), player = usePlayback();
  const [tracks, setTracks] = useState<Track[]>([]), [cursor, setCursor] = useState<string>();
  const [pending, setPending] = useState<PrivateCreate[]>([]), [results, setResults] = useState<Record<string, PrivateResult>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [recoveryError, setRecoveryError] = useState<string>();
  const [noticeArea, setNoticeArea] = useState<string>('recovery');
  const [notice, setNotice] = useState<string>(), [file, setFile] = useState<MediaFile>(), [title, setTitle] = useState(''), [artist, setArtist] = useState(''), [description, setDescription] = useState(''), [tags, setTags] = useState(''), [consent, setConsent] = useState(false);
  const live = useRef(true), locked = useRef(false), generation = useRef(0), ownAttempt = useRef<string | undefined>(undefined);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const [list, operations] = await Promise.allSettled([pds.list(), pds.pending()]);
    if (!live.current || getAuth().rpc !== auth.rpc || getAuth().did !== auth.did || version !== generation.current) return;
    if (list.status === 'fulfilled') { setTracks(list.value.tracks); setCursor(list.value.cursor); setError(undefined); }
    else setError(list.reason instanceof Error ? list.reason.message : 'could not load private music.');
    if (operations.status === 'fulfilled') { setPending(operations.value); setRecoveryError(undefined); }
    else setRecoveryError('could not load private creation recovery. try again.');
    setLoading(false);
  }, [pds, auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function run(action: () => Promise<void>, reload = true, area = 'recovery') {
    if (!current() || locked.current) return;
    locked.current = true; setBusy(true); setNotice(undefined); setNoticeArea(area);
    try { await action(); }
    catch (failure) { if (current()) setNotice(failure instanceof Error ? failure.message : 'could not update private music.'); }
    finally { locked.current = false; if (current()) { if (reload) await refresh(); setBusy(false); } }
  }
  function reset(operation: PrivateCreate) {
    if (!current() || ownAttempt.current !== operation.rkey) return;
    ownAttempt.current = undefined; setFile(undefined); setTitle(''); setDescription(''); setTags(''); setConsent(false);
  }
  const active = pending.some(operation => !operation.archived);
  return <>
    <Copy>these live in your own PDS and only you can hear them. they show up in your music with everything else, marked “only you”. uploading here doesn’t change who can hear anything you already published.</Copy>
    {notice && noticeArea === 'recovery' && <Copy live>{notice}</Copy>}
    {recoveryError && <><Copy live>{recoveryError}</Copy><Action label="Retry private recovery" onPress={() => void refresh()} /></>}
    {pending.map(operation => <View key={operation.rkey} style={{ gap: 10 }}>
      {notice && noticeArea === operation.rkey && <Copy live>{notice}</Copy>}
      <Heading>{typeof operation.record.title === 'string' ? operation.record.title : 'private creation'}</Heading>
      <Copy>{results[operation.rkey]?.state === 'accepted' ? 'saved in your private space.' : operation.archived ? 'earlier private attempt. it may still appear.' : 'private creation needs confirmation.'}</Copy>
      <Action label="Check private creation" disabled={busy} onPress={() => void run(async () => { const result = await pds.recover(operation); if (current()) setResults(values => ({ ...values, [operation.rkey]: result })); }, true, operation.rkey)} />
      {results[operation.rkey]?.state === 'different' ? <><Copy>a different private record is already here. it will not be overwritten.</Copy>
        <Action label="Keep existing private track" disabled={busy} onPress={() => void run(async () => { await pds.dismiss(operation, true); reset(operation); }, true, operation.rkey)} /></>
        : results[operation.rkey]?.state === 'accepted' ? <Action label="Done with private upload" disabled={busy} onPress={() => void run(async () => { await pds.dismiss(operation); reset(operation); }, true, operation.rkey)} />
          : <Action label="Resume private creation" disabled={busy} onPress={() => void run(async () => { const result = await pds.recover(operation, true); if (current()) setResults(values => ({ ...values, [operation.rkey]: result })); }, true, operation.rkey)} />}
      {!operation.archived && results[operation.rkey]?.state !== 'accepted' && <><Copy>this attempt may still appear. starting again could create a duplicate.</Copy>
        <Action label="Set aside private creation" disabled={busy} onPress={() => void run(async () => { await pds.archive(operation, true); reset(operation); }, true, operation.rkey)} /></>}
    </View>)}
    <Heading>only you can hear these</Heading>
    {loading ? <Copy>loading private music…</Copy> : error ? <><Copy live>{error}</Copy><Action label="Retry private music" onPress={() => void refresh()} /></> : !tracks.length ? <Copy>no private tracks yet.</Copy> : null}
    {tracks.map(track => <View key={track.record.uri} style={{ gap: 6 }}><Action label={`Play ${track.metadata.title}`} onPress={() => player.play(track, tracks)} /><Copy>{track.metadata.artist_name}</Copy>
      <PrivateTrackDelete track={track} auth={auth} deletion={pds.deletion} pending={pending.some(operation => operation.uri === track.record.uri)} deleted={() => {
        if (getAuth().did !== auth.did || getAuth().rpc !== auth.rpc) return;
        player.forgetPrivateTrack(track.record.uri);
        if (live.current) setTracks(values => values.filter(item => item.record.uri !== track.record.uri));
      }} />
    </View>)}
    {cursor && <Action label="Load more private tracks" disabled={busy} onPress={() => void run(async () => {
      const version = generation.current, next = await pds.list(cursor);
      if (current() && generation.current === version) { setTracks(values => [...values, ...next.tracks.filter(track => !values.some(item => item.record.uri === track.record.uri))]); setCursor(next.cursor); }
    }, false)} />}
    <Heading>upload just for you</Heading>
    <Copy>up to 100 MiB. private uploads do not support transcoding or separate supporter and download rules yet.</Copy>
    {!auth.privatePublishing ? <Action label="Sign in for private uploads" href={{ pathname: '/login', params: { return_to: '/private' } }} /> : <>
      <Action label={file?.name ?? 'Choose private audio'} disabled={busy || active} onPress={() => { setNoticeArea('upload'); void pickMedia('audio/*').then(next => {
        if (!next || !current()) return;
        if (next.size > 104_857_600) { setNotice('private audio is limited to 100 MiB.'); return; }
        setFile(next); setConsent(false); if (!title) setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 256));
      }).catch(() => { if (current()) setNotice('could not open the file.'); }); }} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy && !active} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} editable={!busy && !active} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy && !active} />
      <TagsField value={tags} onChange={setTags} disabled={busy || active} />
      <Action label="Use my private space" selected={consent} disabled={busy || active} onPress={() => setConsent(value => !value)} />
      {error && error !== notice && <Copy live>{error}</Copy>}
      {notice && noticeArea === 'upload' && <Copy live>{notice}</Copy>}
      <Action primary label={busy ? 'Saving private music…' : 'Upload privately'} disabled={busy || active || loading || !!error || !!recoveryError || !consent || !file || !title.trim() || !artist.trim()} onPress={() => void run(async () => {
        if (!file) return;
        const duration = await measureAudioDuration(file).catch(() => undefined);
        if (!current()) return;
        const result = await pds.upload({ file, title, artist, description, tags: tags.split('\n'), duration }, operation => { if (current()) ownAttempt.current = operation.rkey; });
        if (current()) setResults(values => ({ ...values, [result.operation.rkey]: result.result }));
      }, true, 'upload')} />
    </>}
  </>;
}
