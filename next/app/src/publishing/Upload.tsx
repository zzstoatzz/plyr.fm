import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { OwnerTrackUpload } from './OwnerTrackUpload';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { View } from 'react-native';
import { useAppearance } from '../appearance';
import { Action, Copy, Field, Page } from '../controls';
import { pickMedia, retype } from '../media-picker';
import type { MediaFile } from '../pds';
import { readLocal, removeLocal, writeLocal } from '../storage';
import { LargeUploads, useLargeUploads } from './LargeUploads';
import { canonicalAudioType, needsPlyrStorage, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
import { uploadQueue, useUploadQueue } from './upload-queue';
import { UploadQueueList } from './UploadQueue';
import { useSharedAudio } from './shared-audio';
import { UploadSignIn } from './UploadSignIn';
import { TagsField } from './TagsField';
import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './CreateRecovery';
import { AudienceToggle, CheckRow, ChooseTrack, FieldError, FormCard, SwitchRow, TrackHero, UploadBar, type TrackDraftFields } from './UploadPieces';
import { UploadSimple } from '../icons';
import { pickArtwork } from './artwork';
import { useArtistName } from './artist-name';
import { QueuedUpload } from './QueuedUpload';
import { queuedDrafts } from './upload-storage';
import { draftInRecovery, type QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';

export default function Upload() {
  const auth = useAuth();
  const { visibility } = useLocalSearchParams<{ visibility?: string }>();
  const onlyYou = visibility === 'only-you';
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="upload">
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <UploadSignIn onlyYou={onlyYou} />
      : <TrackUpload key={`${auth.did}:${session.version}`} auth={auth} onlyYou={onlyYou} />}
  </Page>;
}

type Draft = { title: string; album: string; description: string; tags: string; named?: boolean; autoTag?: boolean };
type Problems = { audio?: string; artwork?: string; tags?: string; form?: string };

function readDraft(key: string): Draft | undefined {
  try {
    const value: unknown = JSON.parse(readLocal(key) ?? 'null');
    if (!value || typeof value !== 'object') return;
    const text = (field: string) => field in value && typeof (value as Record<string, unknown>)[field] === 'string' ? (value as Record<string, string>)[field] : '';
    const draft = { title: text('title'), album: text('album'), description: text('description'), tags: text('tags') };
    return Object.values(draft).some(Boolean) ? {
      ...draft,
      named: 'named' in value && value.named === true,
      autoTag: 'autoTag' in value && typeof value.autoTag === 'boolean' ? value.autoTag : undefined,
    } : undefined;
  } catch { return; }
}

function tagProblem(tags: string) {
  try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return; }
  catch (failure) { return failure instanceof Error ? failure.message : 'check the tags.'; }
}

function TrackUpload({ auth, onlyYou }: { auth: Auth; onlyYou: boolean }) {
  const [restored] = useState(() => readDraft(`plyr-upload-draft:${auth.did}`));
  const [file, setFile] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState(restored?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? '');
  const [tags, setTags] = useState(restored?.tags ?? '');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [ownerVisited, setOwnerVisited] = useState(onlyYou);
  useEffect(() => { if (onlyYou) setOwnerVisited(true); }, [onlyYou]);
  const draft = { file, setFile, title, setTitle, description, setDescription, tags, setTags };
  const audience = <AudienceToggle onlyYou={onlyYou} disabled={ownerBusy || openBusy} select={value => router.setParams({ visibility: value ? 'only-you' : undefined })} />;
  return <>
    <View style={onlyYou ? { display: 'none' } : { gap: 16 }}>
      <AccountUpload {...draft} auth={auth} restored={restored} onBusy={setOpenBusy} audience={audience} />
    </View>
    {(onlyYou || ownerVisited) && <View style={onlyYou ? { gap: 14 } : { display: 'none' }}>
      <OwnerTrackUpload {...draft} auth={auth} selected={onlyYou} onBusy={setOwnerBusy} audience={audience} />
    </View>}
  </>;
}

function AccountUpload({ auth, restored, onBusy, audience, file, setFile, title, setTitle, description, setDescription, tags, setTags }: TrackDraftFields & { auth: Auth; restored?: Draft; onBusy: (value: boolean) => void; audience: ReactNode }) {
  const live = useRef(true);
  const draftKey = `plyr-upload-draft:${auth.did}`;
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  // The title the last audio file gave, so a later pick may replace it; a typed title is never replaced.
  const autoTitle = useRef<string | undefined>(restored?.named ? restored.title : undefined);
  const [album, setAlbum] = useState(restored?.album ?? '');
  const consentKey = `plyr-storage-consent:${auth.did}`;
  const [serviceConsent, setServiceConsent] = useState(() => readLocal(consentKey) === 'yes');
  const autoTagKey = `plyr-auto-tag:${auth.did}`;
  const [autoTag, setAutoTag] = useState(() => restored?.autoTag ?? readLocal(autoTagKey) === 'yes');
  const [problems, setProblems] = useState<Problems>({});
  const [draftProblem, setDraftProblem] = useState('');
  const [queuedProblem, setQueuedProblem] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<QueuedUploadDraft[]>([]);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [reattach, setReattach] = useState(!!restored);
  const queue = useUploadQueue();
  const busy = uploadQueue.busy();
  const recovery = useCreateRecovery(auth, 'track');
  const uploads = useLargeUploads(auth, recovery.refresh, () => {});
  const ours = (operation: { rkey: string }) => busy.rkeys.has(operation.rkey) || uploads.operations.some(upload => upload.rkey === operation.rkey);
  const creationRecovery = { ...recovery, operations: recovery.operations.filter(operation => !ours(operation)), archived: recovery.archived.filter(operation => !ours(operation)) };
  const service = !!file && needsPlyrStorage(file);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const settled = queue.filter(job => !uploadInProgress(job.phase)).map(job => job.id).join();
  useEffect(() => { void recovery.refresh(); void uploads.refresh(); }, [settled]);
  const refreshDrafts = useCallback(async () => {
    const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
    try {
      const next = auth.did ? await queuedDrafts.load(auth.did) : [];
      if (current()) { setSavedDrafts(next); setQueuedProblem(''); }
    } catch {
      if (current()) setQueuedProblem('could not load queued uploads. try again.');
    }
  }, [auth.did, auth.rpc]);
  const linkedDrafts = [...recovery.operations, ...recovery.archived, ...uploads.operations].map(operation => operation.draftId).join();
  useEffect(() => { void refreshDrafts(); }, [refreshDrafts, settled, linkedDrafts]);
  // Everything typed survives a reload, a crash or the sign-in-again round trip; files are chosen again.
  const editorDraft = JSON.stringify({ title, album, description, tags, autoTag, named: !!title && title === autoTitle.current });
  const latestDraft = useRef({ file, artwork, editorDraft });
  latestDraft.current = { file, artwork, editorDraft };
  useEffect(() => {
    try {
      if (title || album || description || tags) {
        writeLocal(draftKey, editorDraft);
        if (readLocal(draftKey) !== editorDraft) throw new Error('draft was not saved');
      } else removeLocal(draftKey);
      setDraftProblem('');
    } catch { setDraftProblem('changes to this draft could not be saved on this device.'); }
  }, [draftKey, editorDraft, title, album, description, tags]);
  const artist = useArtistName(auth);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const tagError = tagProblem(tags);
  const theme = useAppearance();
  const editing = !!file || !!artwork || reattach || !!(title || album || description || tags);

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

  async function editAgain(id: string) {
    const input = await uploadQueue.takeBack(id, input => {
      if (!current()) throw new Error('reopen the upload page to edit this draft.');
      const previous = readLocal(draftKey);
      const saved = JSON.stringify({ title: input.title, album: input.album, description: input.description, tags: input.tags?.join('\n'), autoTag: !!input.autoTag });
      writeLocal(draftKey, saved);
      if (readLocal(draftKey) !== saved) throw new Error('could not save the editor draft.');
      return () => {
        if (readLocal(draftKey) !== saved) return;
        if (previous === null) removeLocal(draftKey);
        else writeLocal(draftKey, previous);
      };
    }).catch(failure => {
      if (current()) setProblems(previous => ({ ...previous, form: failure instanceof Error ? failure.message : 'could not reopen the upload. try again.' }));
    });
    if (!input || !current()) return;
    setFile(input.file); setArtwork(input.artwork ?? null); setTitle(input.title); setAlbum(input.album ?? '');
    setDescription(input.description ?? ''); setTags(input.tags?.join('\n') ?? '');
    setAutoTag(!!input.autoTag); setReattach(false);
    setProblems({});
  }

  async function upload() {
    if (submitting.current || !current() || !file || !title.trim() || !artist || tagError || (service && (!serviceConsent || !auth.uploadStorage))) return;
    submitting.current = true;
    onBusy(true);
    setSaving(true);
    try {
      const list = tags.trim() ? tags.split('\n') : undefined;
      await uploadQueue.add({ file, artwork, title, artist, album, description, tags: list, autoTag });
      try {
        if (readLocal(draftKey) === editorDraft) removeLocal(draftKey);
      } catch {
        if (current()) setDraftProblem('the upload was queued, but this device could not clear the editor draft.');
      }
      if (!current() || latestDraft.current.file !== file || latestDraft.current.artwork !== artwork || latestDraft.current.editorDraft !== editorDraft) return;
      autoTitle.current = undefined;
      setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription(''); setTags(''); setProblems({});
    } catch (failure) {
      if (current()) setProblems(previous => ({ ...previous, form: failure instanceof Error ? failure.message : 'could not start the upload.' }));
    } finally {
      submitting.current = false;
      if (current()) { onBusy(false); setSaving(false); }
    }
  }

  return <>
    <UploadQueueList onEdit={saving ? undefined : id => void editAgain(id)} />
    {!!queuedProblem && <><Copy live>{queuedProblem}</Copy><Action label="Retry queued uploads" onPress={() => void refreshDrafts()} /></>}
    {savedDrafts.filter(draft => !draftInRecovery(draft, recovery.operations, recovery.archived, uploads.operations) &&
      !queue.some(job => job.id === draft.id)).map(draft =>
      <QueuedUpload key={draft.id} draft={draft} refresh={refreshDrafts} />)}
    <LargeUploads uploads={uploads} skip={busy.uploadIds} />
    <EarlierCreates auth={auth} recovery={creationRecovery} kind="track" />
    {creationRecovery.loading || creationRecovery.error || creationRecovery.operations.length ? <CreateRecovery auth={auth} recovery={creationRecovery} kind="track" onDismiss={() => {}} /> : <>
      {editing ? <TrackHero artwork={artwork} onArtwork={() => void chooseArtwork()} onRemoveArtwork={() => setArtwork(null)} title={title} setTitle={setTitle}
        artist={artist} file={file} reattach={reattach} onAudio={() => void chooseAudio()}>
        {problems.audio && <FieldError>{problems.audio}</FieldError>}
        {problems.artwork && <FieldError>{problems.artwork}</FieldError>}
        {service && <View style={{ alignSelf: 'stretch', gap: 4, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.glassBorder, backgroundColor: theme.glass }}>
          <CheckRow label="use plyr storage" checked={serviceConsent} onChange={consent} />
          <Copy>plyr keeps the original file and makes an mp3 so it plays everywhere. playback and downloads are public.</Copy>
          {!auth.uploadStorage && <><Copy>sign in again to allow plyr storage. what you typed stays here; you will choose the file again.</Copy><Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
        </View>}
      </TrackHero> : <ChooseTrack onPress={() => void chooseAudio()} artist={artist}>
        {problems.audio && <FieldError>{problems.audio}</FieldError>}
      </ChooseTrack>}
      {editing && <FormCard>
        <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} placeholder="optional" />
        <View style={{ gap: 8 }}>
          <TagsField value={tags} onChange={setTags} disabled={false} />
          {tagError && <FieldError>{tagError}</FieldError>}
        </View>
        <SwitchRow label="auto-tag with recommended genres" detail="we listen once it's up and add a few genre tags. you can remove them later." value={autoTag}
          onChange={value => { setAutoTag(value); if (value) writeLocal(autoTagKey, 'yes'); else removeLocal(autoTagKey); }} />
        <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="liner notes, credits, lyrics…" style={{ minHeight: 110 }} />
        {description.length > 4500 && <Copy>{description.length} / 5000</Copy>}
      </FormCard>}
      {draftProblem && <FieldError>{draftProblem}</FieldError>}
      {problems.form && <FieldError>{problems.form}</FieldError>}
      <UploadBar audience={audience}>
        <Action primary icon={UploadSimple} label="Upload" onPress={() => void upload()} disabled={saving || !file || !title.trim() || !artist || !!tagError || (service && (!serviceConsent || !auth.uploadStorage))} />
      </UploadBar>
      {!!file && <Copy>you can keep browsing while it uploads.</Copy>}
    </>}
  </>;
}
