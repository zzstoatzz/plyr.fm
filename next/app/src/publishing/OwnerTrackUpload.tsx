import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { getAuth, type Auth } from '../auth-state';
import type { MediaFile } from '../pds';
import { Action, Copy, Field } from '../controls';
import { Heading } from '../CatalogPieces';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { TagsField } from './TagsField';
import { privatePds, type PrivateResult } from './private-pds';
import type { PrivateCreate } from '@plyr/next-core/publishing/private-music';
import { useArtistName } from './artist-name';

export function OwnerTrackUpload({ auth }: { auth: Auth }) {
  const artist = useArtistName(auth);
  const pds = useMemo(() => privatePds(auth), [auth.did, auth.rpc]);
  const [pending, setPending] = useState<PrivateCreate[]>([]), [results, setResults] = useState<Record<string, PrivateResult>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [recoveryError, setRecoveryError] = useState<string>();
  const [noticeArea, setNoticeArea] = useState<string>('recovery');
  const [notice, setNotice] = useState<string>(), [file, setFile] = useState<MediaFile>(), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [tags, setTags] = useState('');
  const live = useRef(true), locked = useRef(false), generation = useRef(0), ownAttempt = useRef<string | undefined>(undefined);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const [operations] = await Promise.allSettled([pds.pending()]);
    if (!live.current || getAuth().rpc !== auth.rpc || getAuth().did !== auth.did || version !== generation.current) return;
    if (operations.status === 'fulfilled') { setPending(operations.value); setRecoveryError(undefined); }
    else setRecoveryError('could not load upload drafts. try again.');
    setLoading(false);
  }, [pds, auth.did, auth.rpc]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function run(action: () => Promise<void>, reload = true, area = 'recovery') {
    if (!current() || locked.current) return;
    locked.current = true; setBusy(true); setNotice(undefined); setNoticeArea(area);
    try { await action(); }
    catch (failure) { if (current()) setNotice(failure instanceof Error ? failure.message : 'could not save this track.'); }
    finally { locked.current = false; if (current()) { if (reload) await refresh(); setBusy(false); } }
  }
  function reset(operation: PrivateCreate) {
    if (!current() || ownAttempt.current !== operation.rkey) return;
    ownAttempt.current = undefined; setFile(undefined); setTitle(''); setDescription(''); setTags('');
  }
  const active = pending.some(operation => !operation.archived);
  return <>
    {notice && noticeArea === 'recovery' && <Copy live>{notice}</Copy>}
    {recoveryError && <><Copy live>{recoveryError}</Copy><Action label="Try again" onPress={() => void refresh()} /></>}
    {pending.map(operation => <View key={operation.rkey} style={{ gap: 10 }}>
      {notice && noticeArea === operation.rkey && <Copy live>{notice}</Copy>}
      <Heading>{typeof operation.record.title === 'string' ? operation.record.title : 'track upload'}</Heading>
      <Copy>{results[operation.rkey]?.state === 'accepted' ? 'track saved.' : operation.archived ? 'this earlier upload might still finish.' : 'this track may already be saved. check its status before trying again.'}</Copy>
      <Action label="Check upload status" disabled={busy} onPress={() => void run(async () => { const result = await pds.recover(operation); if (current()) setResults(values => ({ ...values, [operation.rkey]: result })); }, true, operation.rkey)} />
      {results[operation.rkey]?.state === 'different' ? <><Copy>another track already exists. keep that track to clear this attempt.</Copy>
        <Action label="Keep existing track" disabled={busy} onPress={() => void run(async () => { await pds.dismiss(operation, true); reset(operation); }, true, operation.rkey)} /></>
        : results[operation.rkey]?.state === 'accepted' ? <Action label="Done with upload" disabled={busy} onPress={() => void run(async () => { await pds.dismiss(operation); reset(operation); if (current()) router.replace('/portal'); }, true, operation.rkey)} />
          : <Action label="Retry upload" disabled={busy} onPress={() => void run(async () => { const result = await pds.recover(operation, true); if (current()) setResults(values => ({ ...values, [operation.rkey]: result })); }, true, operation.rkey)} />}
      {!operation.archived && results[operation.rkey]?.state !== 'accepted' && <><Copy>this attempt may still appear. starting again could create a duplicate.</Copy>
        <Action label="Set aside upload" disabled={busy} onPress={() => void run(async () => { await pds.archive(operation, true); reset(operation); }, true, operation.rkey)} /></>}
    </View>)}
    {!auth.privatePublishing ? <Action label="Sign in for uploads" href={{ pathname: '/login', params: { return_to: '/upload?visibility=only-you' } }} /> : <>
      <Action label={file?.name ?? 'Choose audio'} disabled={busy || active} onPress={() => { setNoticeArea('upload'); void pickMedia('audio/*').then(next => {
        if (!next || !current()) return;
        if (next.size > 104_857_600) { setNotice('audio for this setting is limited to 100 MiB.'); return; }
        setFile(next); if (!title) setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 256));
      }).catch(() => { if (current()) setNotice('could not open the file.'); }); }} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy && !active} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy && !active} />
      <TagsField value={tags} onChange={setTags} disabled={busy || active} />
      {notice && noticeArea === 'upload' && <Copy live>{notice}</Copy>}
      <Action primary label={busy ? 'Saving…' : 'Upload'} disabled={busy || active || loading || !!recoveryError || !file || !title.trim() || !artist} onPress={() => void run(async () => {
        if (!file) return;
        const duration = await measureAudioDuration(file).catch(() => undefined);
        if (!current()) return;
        const result = await pds.upload({ file, title, artist, description, tags: tags.split('\n'), duration }, operation => { if (current()) ownAttempt.current = operation.rkey; });
        if (!current()) return;
        setResults(values => ({ ...values, [result.operation.rkey]: result.result }));
        if (result.result.state === 'accepted') {
          await pds.dismiss(result.operation);
          if (current()) router.replace('/portal');
        }
      }, true, 'upload')} />
    </>}
  </>;
}
