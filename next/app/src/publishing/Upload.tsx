import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { Action, Copy, Field, Page } from '../controls';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { createPds, MAX_AUDIO_BYTES, type MediaFile } from '../pds';
import { LargeUploads, useLargeUploads } from './LargeUploads';
import { MAX_SERVICE_AUDIO_BYTES } from './upload-model';
import type { CreateReservation } from './create-operation';
import { TagsField } from './TagsField';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './CreateRecovery';

export default function Upload() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="upload">
    <Action label="Private music" href="/private" />
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
  const [processAudio, setProcessAudio] = useState(false);
  const [outputMiB, setOutputMiB] = useState('128');
  const [note, setNote] = useState<string>();
  const recovery = useCreateRecovery(auth, 'track');
  const uploads = useLargeUploads(auth, recovery.refresh, resetCreation);
  const creationRecovery = { ...recovery, operations: recovery.operations.filter(operation => !uploads.operations.some(upload => upload.uri === operation.uri)),
    archived: recovery.archived.filter(operation => !uploads.operations.some(upload => upload.uri === operation.uri)) };
  const large = !!file && file.size > MAX_AUDIO_BYTES;
  const service = large || processAudio;
  const outputBudget = /^\d+$/.test(outputMiB) ? Number(outputMiB) * 1024 * 1024 : 0;
  const maximumOutputMiB = Math.floor((2 * MAX_SERVICE_AUDIO_BYTES - (file?.size ?? 0)) / (1024 * 1024));
  const validBudget = Number.isSafeInteger(outputBudget) && outputBudget > 0 && Number(outputMiB) <= maximumOutputMiB;
  function resetCreation(operation: CreateReservation) {
    if (operation.rkey !== currentCreation.current) return;
    currentCreation.current = undefined;
    setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription(''); setTags(''); setNote(undefined); setServiceConsent(false); setProcessAudio(false); setOutputMiB('128');
  }
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;

  async function choose(kind: 'audio/*' | 'image/*') {
    try {
      const item = await pickMedia(kind);
      if (!item || !current()) return;
      if (kind === 'audio/*') {
        if (item.size > MAX_SERVICE_AUDIO_BYTES) throw new Error('audio files are limited to 1.5 GiB.');
        setFile(item); setServiceConsent(false);
        if (!title) setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
      } else setArtwork(item);
    } catch (failure) {
      if (current()) setNote(failure instanceof Error ? failure.message : 'could not open the file.');
    }
  }

  async function upload() {
    if (!current() || !file || locked.current || recovery.operations.length || !title.trim() || !artist.trim()) return;
    if (service && (!serviceConsent || !auth.uploadStorage || uploads.loading || uploads.error || (processAudio && !validBudget))) return;
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
      if (service) await uploads.start(input, reservation, processAudio ? { recipe: 'mp3-320k-44100-v1', outputBudget } : undefined);
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
      <Copy>audio up to 100 MiB can go to your PDS. larger public files and MP3 conversion use plyr storage, up to 1.5 GiB per source file.</Copy>
      <Action label={file?.name ?? 'Choose audio'} onPress={() => void choose('audio/*')} disabled={busy} />
      {file && <Action label="Create MP3 playback" selected={processAudio} disabled={busy} onPress={() => { setProcessAudio(value => !value); setServiceConsent(false); }} />}
      {processAudio && <>
        <Copy>creates 320 kbps MP3 playback and retains your original for download. both copies become public. AIFF and WebM require this option. your PDS record links to plyr storage; it does not contain a portable original blob.</Copy>
        <Field label="MP3 space to reserve (MiB)" value={outputMiB} onChangeText={value => { setOutputMiB(value); setServiceConsent(false); }} keyboardType="number-pad" editable={!busy} />
        <Copy>128 MiB holds roughly 55 minutes of MP3 audio. choose up to {maximumOutputMiB} MiB. source size does not predict MP3 size; processing stops if this reservation is too small, and it cannot be enlarged yet.</Copy>
        {!validBudget && <Copy live>enter a whole number from 1 to {maximumOutputMiB} MiB.</Copy>}
      </>}
      {service && <>
        <Copy>audio is stored by plyr, not your PDS. playback and downloads are public and remain public after publishing. protected audio and restricted downloads are not supported here.</Copy>
        {processAudio && validBudget && file && <Copy>reserving {Math.ceil(file.size / (1024 * 1024))} MiB for the original plus {outputMiB} MiB for MP3 output. other unfinished uploads also count toward your 3 GiB limit.</Copy>}
        <Action label="Use plyr storage" selected={serviceConsent} disabled={busy} onPress={() => setServiceConsent(value => !value)} />
        {!auth.uploadStorage && <><Copy>sign in again to grant plyr storage permission. you will need to select the file again.</Copy><Action label="Sign in for large uploads" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
      </>}
      <Action label={artwork?.name ?? 'Choose cover art'} onPress={() => void choose('image/*')} disabled={busy} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} editable={!busy} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} />
      <TagsField value={tags} onChange={setTags} disabled={busy} />
      {!!recovery.operations.length && <Copy>finish or set aside the earlier creation before uploading another track.</Copy>}
      <Action label={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !!uploads.busy || !!recovery.operations.length || !file || !title.trim() || !artist.trim() || (service && (!serviceConsent || !auth.uploadStorage || uploads.loading || !!uploads.error || (processAudio && !validBudget)))} />
      {note && <Copy live>{note}</Copy>}
    </>}
  </>;
}
