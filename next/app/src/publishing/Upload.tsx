import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { View } from 'react-native';
import { Action, Copy, Field, Page, row } from '../controls';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { createPds, MAX_AUDIO_BYTES, type MediaFile } from '../pds';
import { LargeUploads, useLargeUploads } from './LargeUploads';
import { MAX_SERVICE_AUDIO_BYTES } from './upload-model';
import { useSharedAudio } from './shared-audio';
import type { CreateReservation } from './create-operation';
import { TagsField } from './TagsField';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './CreateRecovery';

export default function Upload() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="upload">
    <View style={{ gap: 8 }}>
      <Copy>who can listen</Copy>
      <View style={row}><Action label="everyone" selected onPress={() => {}} /><Action label="just you" href="/private" /></View>
    </View>
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/upload' } }} />
      : <AccountUpload key={`${auth.did}:${session.version}`} auth={auth} />}
  </Page>;
}

function AccountUpload({ auth }: { auth: Auth }) {
  const live = useRef(true);
  const locked = useRef(false);
  const currentCreation = useRef<string | undefined>(undefined);
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceConsent, setServiceConsent] = useState(false);
  const [note, setNote] = useState<string>();
  const recovery = useCreateRecovery(auth, 'track');
  const uploads = useLargeUploads(auth, recovery.refresh, resetCreation);
  const creationRecovery = { ...recovery, operations: recovery.operations.filter(operation => !uploads.operations.some(upload => upload.uri === operation.uri)),
    archived: recovery.archived.filter(operation => !uploads.operations.some(upload => upload.uri === operation.uri)) };
  const large = !!file && file.size > MAX_AUDIO_BYTES;
  function resetCreation(operation: CreateReservation) {
    if (operation.rkey !== currentCreation.current) return;
    currentCreation.current = undefined;
    setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription(''); setTags(''); setNote(undefined); setServiceConsent(false);
  }
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;

  async function choose(kind: 'audio/*' | 'image/*') {
    try {
      const item = await pickMedia(kind);
      if (!item || !current()) return;
      if (kind === 'audio/*') takeAudio(item);
      else setArtwork(item);
    } catch (failure) {
      if (current()) setNote(failure instanceof Error ? failure.message : 'could not open the file.');
    }
  }

  function takeAudio(item: MediaFile) {
    if (item.size > MAX_SERVICE_AUDIO_BYTES) throw new Error('audio files are limited to 1.5 GiB.');
    setFile(item); setServiceConsent(false);
    if (!title) setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
  }
  useSharedAudio(item => {
    if (busy || !current()) return;
    try { takeAudio(item); setNote(undefined); } catch (failure) { setNote(failure instanceof Error ? failure.message : 'could not open the shared file.'); }
  });

  async function upload() {
    if (!current() || !file || locked.current || recovery.operations.length || !title.trim() || !artist.trim()) return;
    if (large && (!serviceConsent || !auth.uploadStorage || uploads.loading || uploads.error)) return;
    locked.current = true;
    setBusy(true);
    setNote(undefined);
    try {
      const duration = await measureAudioDuration(file).catch(() => undefined);
      if (!current()) return;
      const pds = createPds(auth), reservation = await pds.reserveCreate('track');
      if (!current()) return;
      currentCreation.current = reservation.rkey;
      const input = { file, artwork, title, artist, album, description, duration, tags: tags.trim() ? tags.split('\n') : undefined };
      if (large) await uploads.start(input, reservation);
      else await pds.uploadTrack(input, reservation);
    } catch (failure) {
      if (current()) setNote(failure instanceof Error ? failure.message : 'upload failed.');
    } finally {
      locked.current = false;
      if (current()) { await recovery.refresh(); setBusy(false); }
    }
  }

  return <>
    <LargeUploads uploads={uploads} disabled={busy} />
    <EarlierCreates auth={auth} recovery={creationRecovery} kind="track" />
    {creationRecovery.loading || creationRecovery.error || creationRecovery.operations.length ? <CreateRecovery auth={auth} recovery={creationRecovery} kind="track" onDismiss={resetCreation} /> : uploads.operations.some(operation => operation.rkey === currentCreation.current) ? null : <>
      <Copy>audio up to 100 MiB goes to your PDS. larger public files can use plyr storage, up to 1.5 GiB.</Copy>
      <Action label={file?.name ?? 'Choose audio'} onPress={() => void choose('audio/*')} disabled={busy} />
      {large && <>
        <Copy>large audio is stored by plyr, not your PDS. playback and downloads are public and remain public after publishing. protected audio, restricted downloads and transcoding are not supported here.</Copy>
        <Action label="Use plyr storage" selected={serviceConsent} disabled={busy} onPress={() => setServiceConsent(value => !value)} />
        {!auth.uploadStorage && <><Copy>sign in again to grant large-upload permission. you will need to select the file again.</Copy><Action label="Sign in for large uploads" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
      </>}
      <Action label={artwork?.name ?? 'Choose cover art'} onPress={() => void choose('image/*')} disabled={busy} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} editable={!busy} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} />
      <TagsField value={tags} onChange={setTags} disabled={busy} />
      {!!recovery.operations.length && <Copy>finish or set aside the earlier creation before uploading another track.</Copy>}
      <Action label={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !!uploads.busy || !!recovery.operations.length || !file || !title.trim() || !artist.trim() || (large && (!serviceConsent || !auth.uploadStorage || uploads.loading || !!uploads.error))} />
      {note && <Copy live>{note}</Copy>}
    </>}
  </>;
}
