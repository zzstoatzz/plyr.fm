import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { View } from 'react-native';
import { Action, Copy, Field, Page } from '../controls';
import { pickMedia, retype } from '../media-picker';
import type { MediaFile } from '../pds';
import { readLocal, removeLocal, writeLocal } from '../storage';
import { LargeUploads, useLargeUploads } from './LargeUploads';
import { canonicalAudioType, needsPlyrStorage } from './upload-queue-model';
import { uploadQueue, useUploadQueue } from './upload-queue';
import { UploadQueueList } from './UploadQueue';
import { usePendingSharedAudio, useSharedAudio } from './shared-audio';
import { TagsField } from './TagsField';
import { normalizeTrackTags } from './track-tags';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './CreateRecovery';
import { AudienceToggle, CheckRow, FieldError, FormCard, PickTile } from './UploadPieces';
import { pickArtwork } from './artwork';
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

type Draft = { title: string; album: string; description: string; tags: string; named?: boolean };
type Problems = { audio?: string; artwork?: string; tags?: string; form?: string };

function readDraft(key: string): Draft | undefined {
  try {
    const value: unknown = JSON.parse(readLocal(key) ?? 'null');
    if (!value || typeof value !== 'object') return;
    const text = (field: string) => field in value && typeof (value as Record<string, unknown>)[field] === 'string' ? (value as Record<string, string>)[field] : '';
    const draft = { title: text('title'), album: text('album'), description: text('description'), tags: text('tags') };
    return Object.values(draft).some(Boolean) ? { ...draft, named: 'named' in value && value.named === true } : undefined;
  } catch { return; }
}

function tagProblem(tags: string) {
  try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return; }
  catch (failure) { return failure instanceof Error ? failure.message : 'check the tags.'; }
}

function AccountUpload({ auth }: { auth: Auth }) {
  const live = useRef(true);
  const draftKey = `plyr-upload-draft:${auth.did}`;
  const [restored] = useState(() => readDraft(draftKey));
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState(restored?.title ?? '');
  // The title the last audio file gave, so a later pick may replace it; a typed title is never replaced.
  const autoTitle = useRef<string | undefined>(restored?.named ? restored.title : undefined);
  const [album, setAlbum] = useState(restored?.album ?? '');
  const [description, setDescription] = useState(restored?.description ?? '');
  const [tags, setTags] = useState(restored?.tags ?? '');
  const [details, setDetails] = useState(!!(restored?.album || restored?.description || restored?.tags));
  const consentKey = `plyr-storage-consent:${auth.did}`;
  const [serviceConsent, setServiceConsent] = useState(() => readLocal(consentKey) === 'yes');
  const autoTagKey = `plyr-auto-tag:${auth.did}`;
  const [autoTag, setAutoTag] = useState(() => readLocal(autoTagKey) === 'yes');
  const [problems, setProblems] = useState<Problems>({});
  const [reattach, setReattach] = useState(!!restored);
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
  // Everything typed survives a reload, a crash or the sign-in-again round trip; files are chosen again.
  useEffect(() => {
    if (title || album || description || tags) writeLocal(draftKey, JSON.stringify({ title, album, description, tags, named: !!title && title === autoTitle.current }));
    else removeLocal(draftKey);
  }, [draftKey, title, album, description, tags]);
  const artist = useArtistName(auth);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const tagError = tagProblem(tags);

  function takeAudio(picked: MediaFile) {
    const item = retype(picked, canonicalAudioType(picked));
    setFile(item); setReattach(false);
    setProblems(previous => ({ ...previous, audio: undefined, form: undefined }));
    // Name the track after the file only when no title was typed.
    const named = item.name.replace(/\.[^.]+$/, '').slice(0, 256);
    if (!title.trim() || title === autoTitle.current) { setTitle(named); autoTitle.current = named; }
  }
  async function chooseAudio() {
    try {
      const item = await pickMedia('audio/*');
      if (item && current()) takeAudio(item);
    } catch (failure) {
      if (current()) setProblems(previous => ({ ...previous, audio: failure instanceof Error ? failure.message : 'could not open that file.' }));
    }
  }
  async function chooseArtwork() {
    try {
      const item = await pickArtwork();
      if (!item || !current()) return;
      setArtwork(item);
      setProblems(previous => ({ ...previous, artwork: undefined, form: undefined }));
    } catch (failure) {
      if (current()) setProblems(previous => ({ ...previous, artwork: failure instanceof Error ? failure.message : 'could not open that image.' }));
    }
  }
  useSharedAudio(item => {
    if (!current()) return;
    try { takeAudio(item); } catch (failure) { setProblems(previous => ({ ...previous, audio: failure instanceof Error ? failure.message : 'could not open the shared file.' })); }
  }, message => { if (current()) setProblems(previous => ({ ...previous, audio: message })); });

  function consent() {
    const next = !serviceConsent;
    setServiceConsent(next);
    if (next) writeLocal(consentKey, 'yes'); else removeLocal(consentKey);
  }

  function editAgain(id: string) {
    const input = uploadQueue.takeBack(id);
    if (!input || !current()) return;
    setFile(input.file); setArtwork(input.artwork ?? null); setTitle(input.title); setAlbum(input.album ?? '');
    setDescription(input.description ?? ''); setTags(input.tags?.join('\n') ?? '');
    setDetails(!!(input.album || input.description || input.tags?.length)); setAutoTag(!!input.autoTag); setReattach(false);
    setProblems({});
  }

  function upload() {
    if (!current() || !file || !title.trim() || !artist || tagError || (service && (!serviceConsent || !auth.uploadStorage))) return;
    try {
      const list = tags.trim() ? tags.split('\n') : undefined;
      uploadQueue.add({ file, artwork, title, artist, album, description, tags: list, autoTag });
    } catch (failure) {
      setProblems(previous => ({ ...previous, form: failure instanceof Error ? failure.message : 'could not start the upload.' }));
      return;
    }
    // Queued: the form is free for the next track. A failure can be put back from the list above.
    removeLocal(draftKey);
    autoTitle.current = undefined;
    setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDetails(false); setDescription(''); setTags(''); setProblems({});
  }

  return <>
    <UploadQueueList onEdit={editAgain} />
    <LargeUploads uploads={uploads} skip={busy.uploadIds} />
    <EarlierCreates auth={auth} recovery={creationRecovery} kind="track" />
    {creationRecovery.loading || creationRecovery.error || creationRecovery.operations.length ? <CreateRecovery auth={auth} recovery={creationRecovery} kind="track" onDismiss={() => {}} /> : <>
      <FormCard>
        <View style={{ gap: 8 }}>
          <PickTile kind="audio" file={file} onPress={() => void chooseAudio()} hint="mp3, wav, flac, aiff, ogg, opus, m4a or aac · up to 1.5 GiB" />
          {problems.audio ? <FieldError>{problems.audio}</FieldError> : reattach && !file ? <Copy>your draft is still here. choose the audio file again.</Copy> : null}
        </View>
        {service && <>
          <Copy>plyr stores this file and makes an mp3 for playback when needed. playback and downloads are public.</Copy>
          {!serviceConsent && <Action label="Use plyr storage" onPress={consent} />}
          {!auth.uploadStorage && <><Copy>sign in again to allow plyr storage. what you typed stays here; you will choose the file again.</Copy><Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
        </>}
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} placeholder="track title" />
        <View style={{ gap: 8 }}>
          <PickTile kind="artwork" file={artwork} onPress={() => void chooseArtwork()} hint="optional · any photo or image" />
          {problems.artwork && <FieldError>{problems.artwork}</FieldError>}
          {artwork && <Action label="Remove cover" onPress={() => setArtwork(null)} />}
        </View>
        {details ? <>
          <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} placeholder="optional" />
          <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="liner notes, credits…" style={{ minHeight: 88 }} />
          {description.length > 4500 && <Copy>{description.length} / 5000</Copy>}
          <View style={{ gap: 8 }}>
            <TagsField value={tags} onChange={setTags} disabled={false} />
            {tagError && <FieldError>{tagError}</FieldError>}
          </View>
        </> : <Action label="add album, description or tags" onPress={() => setDetails(true)} />}
        <CheckRow label="auto-tag with recommended genres" checked={autoTag} onChange={value => { setAutoTag(value); if (value) writeLocal(autoTagKey, 'yes'); else removeLocal(autoTagKey); }} />
        <View style={{ gap: 8 }}>
          {problems.form && <FieldError>{problems.form}</FieldError>}
          <Action primary label="Upload" onPress={upload} disabled={!file || !title.trim() || !artist || !!tagError || (service && (!serviceConsent || !auth.uploadStorage))} />
          {!!artist && <Copy>posts to your profile as {artist}. you can keep browsing while it uploads.</Copy>}
        </View>
      </FormCard>
    </>}
  </>;
}
