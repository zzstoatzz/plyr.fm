import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { View } from 'react-native';
import { Action, Copy, Field, Page } from '../controls';
import { pickMedia } from '../media-picker';
import type { MediaFile } from '../pds';
import { readLocal, removeLocal, writeLocal } from '../storage';
import { LargeUploads, useLargeUploads } from './LargeUploads';
import { needsPlyrStorage, uploadRoute } from './upload-queue-model';
import { uploadQueue, useUploadQueue } from './upload-queue';
import { UploadQueueList } from './UploadQueue';
import { usePendingSharedAudio, useSharedAudio } from './shared-audio';
import { TagsField } from './TagsField';
import { normalizeTrackTags } from './track-tags';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './CreateRecovery';
import { AudienceToggle, FormCard, PickTile } from './UploadPieces';
import { useArtistName } from './artist-name';

export default function Upload() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="upload">
    <AudienceToggle />
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <SignedOut />
      : <AccountUpload key={`${auth.did}:${session.version}`} auth={auth} />}
  </Page>;
}

function SignedOut() {
  const shared = usePendingSharedAudio();
  return <>
    {shared && <Copy>sign in to upload {shared}.</Copy>}
    <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/upload' } }} />
  </>;
}

function AccountUpload({ auth }: { auth: Auth }) {
  const live = useRef(true);
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState(false);
  const [album, setAlbum] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const consentKey = `plyr-storage-consent:${auth.did}`;
  const [serviceConsent, setServiceConsent] = useState(() => readLocal(consentKey) === 'yes');
  const [note, setNote] = useState<string>();
  const queue = useUploadQueue();
  const busy = uploadQueue.busy();
  const recovery = useCreateRecovery(auth, 'track');
  const uploads = useLargeUploads(auth, recovery.refresh, () => {});
  const ours = (operation: { rkey: string }) => busy.rkeys.has(operation.rkey) || uploads.operations.some(upload => upload.rkey === operation.rkey);
  const creationRecovery = { ...recovery, operations: recovery.operations.filter(operation => !ours(operation)), archived: recovery.archived.filter(operation => !ours(operation)) };
  const service = !!file && needsPlyrStorage(file);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const settled = queue.filter(job => job.phase === 'done' || job.phase === 'failed').map(job => job.id).join();
  useEffect(() => { void recovery.refresh(); void uploads.refresh(); }, [settled]);
  const artist = useArtistName(auth);
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
    uploadRoute(item);
    setFile(item); setNote(undefined);
    setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
  }
  useSharedAudio(item => {
    if (!current()) return;
    try { takeAudio(item); } catch (failure) { setNote(failure instanceof Error ? failure.message : 'could not open the shared file.'); }
  }, message => { if (current()) setNote(message); });

  function consent() {
    const next = !serviceConsent;
    setServiceConsent(next);
    if (next) writeLocal(consentKey, 'yes'); else removeLocal(consentKey);
  }

  function upload() {
    if (!current() || !file || !title.trim() || !artist || (service && (!serviceConsent || !auth.uploadStorage))) return;
    try {
      const list = tags.trim() ? tags.split('\n') : undefined;
      if (list) normalizeTrackTags(list);
      uploadQueue.add({ file, artwork, title, artist, album, description, tags: list });
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'upload failed.');
      return;
    }
    setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDetails(false); setDescription(''); setTags(''); setNote(undefined);
  }

  return <>
    <UploadQueueList />
    <LargeUploads uploads={uploads} skip={busy.uploadIds} />
    <EarlierCreates auth={auth} recovery={creationRecovery} kind="track" />
    {creationRecovery.loading || creationRecovery.error || creationRecovery.operations.length ? <CreateRecovery auth={auth} recovery={creationRecovery} kind="track" onDismiss={() => {}} /> : <>
      <FormCard>
        <PickTile kind="audio" file={file} onPress={() => void choose('audio/*')} hint="mp3, wav, flac, aiff, ogg, m4a or aac · up to 1.5 GiB" />
        {note && <Copy live>{note}</Copy>}
        {service && <>
          <Copy>plyr stores this file and makes an mp3 for playback when needed. playback and downloads are public.</Copy>
          {!serviceConsent && <Action label="Use plyr storage" onPress={consent} />}
          {!auth.uploadStorage && <><Copy>sign in again to allow plyr storage. you will need to select the file again.</Copy><Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
        </>}
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} placeholder="track title" />
        <PickTile kind="artwork" file={artwork} onPress={() => void choose('image/*')} hint="optional · jpg, png, webp or gif" />
        {details ? <>
          <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} placeholder="optional" />
          <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="liner notes, credits…" style={{ minHeight: 88 }} />
          <TagsField value={tags} onChange={setTags} disabled={false} />
        </> : <Action label="add album, description or tags" onPress={() => setDetails(true)} />}
        <View style={{ gap: 8 }}>
          <Action primary label="Upload" onPress={upload} disabled={!file || !title.trim() || !artist || (service && (!serviceConsent || !auth.uploadStorage))} />
          {!!artist && <Copy>posts to your profile as {artist}. you can keep browsing while it uploads.</Copy>}
        </View>
      </FormCard>
    </>}
  </>;
}
