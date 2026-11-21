import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePrivateUploads } from './PrivateUploads';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { Pressable, View, type ScrollViewInstance } from 'react-native';
import { useAppearance } from '../appearance';
import { Action, Copy, Field, Page } from '../controls';
import { Text } from '../Text';
import { Globe, Lock } from '../icons';
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
import { CheckRow, ChooseTrack, FieldError, FormCard, SwitchRow, TrackHero, UploadBar } from './UploadPieces';
import { AccessSection } from './AccessSection';
import { FeatureField } from './FeatureField';
import { accessFromRules, accessProblem, accessRules, accessSummary, onlyYou, readAccessDraft, OPEN, type AccessDraft } from '@plyr/next-core/publishing/upload-access';
import { memberDid } from '@plyr/next-core/access/policy-read';
import { MAX_AUDIO_BYTES, type FeaturedArtist } from '@plyr/next-core/pds';
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
  const scroll = useRef<ScrollViewInstance>(null);
  return <Page title="upload" scrollRef={scroll}>
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <UploadSignIn onlyYou={onlyYou} />
      : <TrackUpload key={`${auth.did}:${session.version}`} auth={auth} onlyYou={onlyYou} scroll={scroll} />}
  </Page>;
}

type Draft = { title: string; album: string; description: string; tags: string; named?: boolean; autoTag?: boolean; features: FeaturedArtist[]; explicit: boolean; access?: AccessDraft };
type Problems = { audio?: string; artwork?: string; tags?: string; form?: string };

function readDraft(key: string): Draft | undefined {
  try {
    const value: unknown = JSON.parse(readLocal(key) ?? 'null');
    if (!value || typeof value !== 'object') return;
    const text = (field: string) => field in value && typeof (value as Record<string, unknown>)[field] === 'string' ? (value as Record<string, string>)[field] : '';
    const saved = value as Record<string, unknown>;
    const draft = { title: text('title'), album: text('album'), description: text('description'), tags: text('tags') };
    const features = Array.isArray(saved.features) ? saved.features.filter((item): item is FeaturedArtist => !!item && typeof item === 'object' && typeof item.did === 'string').slice(0, 10) : [];
    return Object.values(draft).some(Boolean) || features.length ? {
      ...draft, features,
      named: saved.named === true,
      autoTag: typeof saved.autoTag === 'boolean' ? saved.autoTag : undefined,
      explicit: saved.explicit === true,
      access: 'access' in saved ? readAccessDraft(saved.access) : undefined,
    } : undefined;
  } catch { return; }
}

function tagProblem(tags: string) {
  try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return; }
  catch (failure) { return failure instanceof Error ? failure.message : 'check the tags.'; }
}

function TrackUpload({ auth, onlyYou: startOnlyYou, scroll }: { auth: Auth; onlyYou: boolean; scroll: RefObject<ScrollViewInstance | null> }) {
  const [restored] = useState(() => readDraft(`plyr-upload-draft:${auth.did}`));
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState(restored?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? '');
  const [tags, setTags] = useState(restored?.tags ?? '');
  const [features, setFeatures] = useState<FeaturedArtist[]>(restored?.features ?? []);
  const [explicit, setExplicit] = useState(restored?.explicit ?? false);
  const [access, setAccess] = useState<AccessDraft>(() => startOnlyYou && !restored?.access?.closed ? { closed: true, ways: [] } : restored?.access ?? { ...OPEN });
  // each way's problem shows once a submit has tried, not while typing
  const [checked, setChecked] = useState(false);
  const accessAt = useRef(0);
  const privateUploads = usePrivateUploads(auth);
  const navigation = useNavigation();
  const live = useRef(true);
  const draftKey = `plyr-upload-draft:${auth.did}`;
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
  const service = !!file && needsPlyrStorage(file, access.closed);
  const privateTrack = onlyYou(access);
  const summary = accessSummary(access);
  const tooLargeClosed = access.closed && !!file && file.size > MAX_AUDIO_BYTES;
  // a closed track needs this session to be allowed to close music and write who can listen
  const accessSignIn = access.closed && !(privateTrack ? auth.privatePublishing : auth.closing && auth.policyEditing);
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
  const editorDraft = JSON.stringify({ title, album, description, tags, autoTag, features, explicit, access, named: !!title && title === autoTitle.current });
  const latestDraft = useRef({ file, artwork, editorDraft });
  latestDraft.current = { file, artwork, editorDraft };
  useEffect(() => {
    try {
      if (title || album || description || tags || features.length) {
        writeLocal(draftKey, editorDraft);
        if (readLocal(draftKey) !== editorDraft) throw new Error('draft was not saved');
      } else removeLocal(draftKey);
      setDraftProblem('');
    } catch { setDraftProblem('changes to this draft could not be saved on this device.'); }
  }, [draftKey, editorDraft, title, album, description, tags, features.length]);
  const artist = useArtistName(auth);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const tagError = tagProblem(tags);
  const theme = useAppearance();
  const editing = !!file || !!artwork || reattach || !!(title || album || description || tags || features.length);

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
      const saved = JSON.stringify({ title: input.title, album: input.album, description: input.description, tags: input.tags?.join('\n'), autoTag: !!input.autoTag, features: input.features ?? [], explicit: !!input.explicit, access: accessFromRules(input.waysIn) });
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
    setAutoTag(!!input.autoTag); setFeatures(input.features ?? []); setExplicit(!!input.explicit); setAccess(accessFromRules(input.waysIn));
    setReattach(false); setChecked(false); setProblems({});
  }

  function clearEditor() {
    autoTitle.current = undefined;
    setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription(''); setTags(''); setFeatures([]); setExplicit(false);
    setAccess({ ...OPEN }); setChecked(false); setProblems({});
  }

  const blocked = saving || privateUploads.busy || !file || !title.trim() || !artist || !!tagError || tooLargeClosed || accessSignIn
    || (privateTrack ? privateUploads.blocked : service && (!serviceConsent || !auth.uploadStorage));

  async function upload() {
    const problem = accessProblem(access);
    if (problem) {
      setChecked(true);
      setProblems(previous => ({ ...previous, form: problem }));
      scroll.current?.scrollTo({ y: Math.max(0, accessAt.current - 16), animated: true });
      return;
    }
    if (submitting.current || !current() || blocked || !file || !artist) return;
    submitting.current = true;
    setSaving(true);
    setProblems(previous => ({ ...previous, form: undefined }));
    const submitted = { file, artwork, editorDraft };
    const unchanged = () => current() && latestDraft.current.file === submitted.file && latestDraft.current.artwork === submitted.artwork && latestDraft.current.editorDraft === submitted.editorDraft;
    const clearSaved = () => {
      try {
        if (readLocal(draftKey) === editorDraft) removeLocal(draftKey);
      } catch {
        if (current()) setDraftProblem('the upload was queued, but this device could not clear the editor draft.');
      }
    };
    try {
      const list = tags.trim() ? tags.split('\n') : undefined;
      if (privateTrack) {
        if (!await privateUploads.save({ file, artwork, title, artist, description, tags: list ?? [] })) return;
        clearSaved();
        if (unchanged()) clearEditor();
        if (current() && navigation.isFocused()) router.replace('/portal');
        return;
      }
      const waysIn = await accessRules(access, memberDid);
      await uploadQueue.add({ file, artwork, title, artist, album, description, tags: list, autoTag,
        ...(features.length ? { features } : {}), ...(explicit ? { explicit: true } : {}), ...(waysIn.length ? { waysIn } : {}) });
      clearSaved();
      if (unchanged()) clearEditor();
    } catch (failure) {
      if (current()) setProblems(previous => ({ ...previous, form: failure instanceof Error ? failure.message : 'could not start the upload.' }));
    } finally {
      submitting.current = false;
      if (current()) setSaving(false);
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
    {privateUploads.view}
    {creationRecovery.loading || creationRecovery.error || creationRecovery.operations.length ? <CreateRecovery auth={auth} recovery={creationRecovery} kind="track" onDismiss={() => {}} /> : <>
      {editing ? <TrackHero artwork={artwork} onArtwork={() => void chooseArtwork()} onRemoveArtwork={() => setArtwork(null)} title={title} setTitle={setTitle}
        artist={artist} file={file} reattach={reattach} onAudio={() => void chooseAudio()}>
        {problems.audio && <FieldError>{problems.audio}</FieldError>}
        {problems.artwork && <FieldError>{problems.artwork}</FieldError>}
        {service && <View style={{ alignSelf: 'stretch', gap: 4, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.surface }}>
          <CheckRow label="use plyr.fm storage" checked={serviceConsent} onChange={consent} />
          <Copy>plyr.fm keeps the original file and makes an mp3 so it plays everywhere. playback and downloads are public.</Copy>
          {!auth.uploadStorage && <><Copy>sign in again to allow plyr.fm storage. what you typed stays here; you will choose the file again.</Copy><Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/upload' } }} /></>}
        </View>}
      </TrackHero> : <ChooseTrack onPress={() => void chooseAudio()} artist={artist}>
        {problems.audio && <FieldError>{problems.audio}</FieldError>}
      </ChooseTrack>}
      {editing && <FormCard>
        {!privateTrack && <>
          <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} placeholder="optional" />
          <FeatureField value={features} onChange={setFeatures} disabled={saving} owner={auth.did ?? undefined} />
        </>}
        <View style={{ gap: 8 }}>
          <TagsField value={tags} onChange={setTags} disabled={false} />
          {tagError && <FieldError>{tagError}</FieldError>}
        </View>
        {privateTrack ? <Copy>album, featuring, auto-tag and explicit apply once someone else can listen.</Copy>
          : <SwitchRow label="auto-tag with recommended genres" detail="we listen once it's up and add a few genre tags. you can remove them later." value={autoTag}
            onChange={value => { setAutoTag(value); if (value) writeLocal(autoTagKey, 'yes'); else removeLocal(autoTagKey); }} />}
        <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="liner notes, credits, lyrics…" style={{ minHeight: 110 }} />
        {description.length > 4500 && <Copy>{description.length} / 5000</Copy>}
        {!privateTrack && <SwitchRow label="explicit lyrics or sounds" detail="listeners who hide explicit audio won’t hear it until they choose to. the label travels with the track." value={explicit} onChange={setExplicit} />}
      </FormCard>}
      {editing && <View onLayout={event => { accessAt.current = event.nativeEvent.layout.y; }}>
        <AccessSection access={access} onChange={next => { setAccess(next); setProblems(previous => ({ ...previous, form: undefined })); }} artist={artist ?? ''} title={title} artwork={artwork}
          disabled={saving} checked={checked} needsSignIn={accessSignIn} />
      </View>}
      {tooLargeClosed && <FieldError>closed tracks can be up to 100 MB for now. choose a smaller file, or make it open.</FieldError>}
      {draftProblem && <FieldError>{draftProblem}</FieldError>}
      {problems.form && <FieldError>{problems.form}</FieldError>}
      {privateUploads.problem && <FieldError>{privateUploads.problem}</FieldError>}
      <UploadBar summary={<Pressable accessibilityRole="button" accessibilityLabel={`who can listen: ${summary.label}${summary.detail ? `, ${summary.detail}` : ''}`} accessibilityHint="shows who can listen"
        onPress={() => scroll.current?.scrollTo({ y: Math.max(0, accessAt.current - 16), animated: true })}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, maxWidth: '55%', paddingHorizontal: 12, borderRadius: 22, backgroundColor: pressed ? theme.hover : theme.raised })}>
        {access.closed ? <Lock size={16} color={theme.muted} /> : <Globe size={16} color={theme.muted} />}
        <View style={{ flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '700' }}>{summary.label}</Text>
          {!!summary.detail && <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>{summary.detail}</Text>}
        </View>
      </Pressable>}>
        <Action primary icon={UploadSimple} label={saving ? 'Saving…' : 'Upload'} onPress={() => void upload()} disabled={blocked} />
      </UploadBar>
      <Copy>by uploading you confirm you have the rights to share this.{file && !privateTrack ? ' you can keep browsing while it uploads.' : ''}</Copy>
    </>}
  </>;
}
