import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { api } from '../api-client';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { useResource } from '../CatalogPieces';
import { Sheet } from '../Sheet';
import { Action, Copy, Field } from '../controls';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { createPds, TrackRevisionConflict, type MediaFile } from '../pds';
import { isOpen } from '@plyr/next-core/access/policy';
import { recordTags } from '@plyr/next-core/publishing/track-tags';
import { TagsField } from './TagsField';
import { Chip, clock, FieldError } from './UploadPieces';
import { trackArtwork } from '@plyr/next-core/artwork';
import { ImageSquare, PencilSimple, Waveform } from '../icons';
import { useAppearance } from '../appearance';
import { Text } from '../Text';
import { usePreviewUri } from './preview-uri';
import { pickArtwork } from './artwork';
import { canReplaceTrackAudio, validateReplacementAudio, TrackWriteUnconfirmed } from '@plyr/next-core/publishing/track-audio';

function close(id: string) { router.canGoBack() ? router.back() : router.replace(`/track/${id}`); }

type EditorNotice = { message: string; reload?: () => void };
type SaveAction = { label: string; disabled: boolean; onPress: () => void };
type EditorFeedback = { busy: (value: boolean) => void; notice: (value?: EditorNotice) => void; save: (value?: SaveAction) => void };

export function TrackEditor({ id }: { id: string }) {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  const key = `${id}:${auth.did}:${session.version}`;
  const owner = useRef({ key, busy: false });
  if (owner.current.key !== key) owner.current = { key, busy: false };
  const [notice, setNotice] = useState<{ key: string; value?: EditorNotice }>();
  const [save, setSave] = useState<{ key: string; value?: SaveAction }>();
  const feedback = useMemo<EditorFeedback>(() => ({
    busy(value) { if (owner.current.key === key) owner.current.busy = value; },
    notice(value) { if (owner.current.key === key) setNotice({ key, value }); },
    save(value) { if (owner.current.key === key) setSave({ key, value }); }
  }), [key]);
  const message = notice?.key === key ? notice.value : undefined;
  const action = save?.key === key ? save.value : undefined;
  const leave = () => { if (!owner.current.busy) close(id); };
  return <Sheet title="edit track" close={leave} bar={{
    leading: <BarButton label="Cancel" onPress={leave} />,
    trailing: action && <BarButton strong label={action.label} disabled={action.disabled} onPress={action.onPress} />
  }} notice={message ? <>
    <Copy live>{message.message}</Copy>
    {message.reload && <Action label="Discard draft and reload" onPress={message.reload} />}
  </> : undefined}>
    <EditorSession key={key} id={id} auth={auth} feedback={feedback} />
  </Sheet>;
}

function BarButton({ label, onPress, disabled, strong }: { label: string; onPress: () => void; disabled?: boolean; strong?: boolean }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 10, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
    <Text style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: strong ? '700' : '400' }}>{label}</Text>
  </Pressable>;
}

function EditorSession({ id, auth, feedback }: { id: string; auth: Auth; feedback: EditorFeedback }) {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const load = useCallback(async () => {
    const track = await api.track(id);
    if (track.artist.did !== auth.did) throw new Error('only the artist can edit this track.');
    const revision = await pds.myTrack(track.record.uri);
    return { track, revision, tags: recordTags(revision.value.tags) };
  }, [id, auth.did, pds]);
  const resource = useResource(load);
  const retry = useRef(resource.retry);
  retry.current = resource.retry;
  const reload = useCallback(() => retry.current(), []);
  if (resource.data) return <TrackForm key={resource.data.revision.cid} auth={auth} data={resource.data} reload={reload} feedback={feedback} />;
  return <>
    {resource.error ? <><Copy live>{resource.error}</Copy><Action label="Retry loading track" onPress={resource.retry} /></>
      : <Copy>loading track…</Copy>}
  </>;
}

type Data = { track: Awaited<ReturnType<typeof api.track>>; revision: Awaited<ReturnType<ReturnType<typeof createPds>['myTrack']>>; tags?: string[] };

function TrackForm({ auth, data, reload, feedback }: { auth: Auth; data: Data; reload: () => void; feedback: EditorFeedback }) {
  const { track, revision } = data;
  const text = (key: string) => {
    const value = revision.value[key];
    return typeof value === 'string' ? value : '';
  };
  const [title, setTitle] = useState(text('title'));
  const [album, setAlbum] = useState(text('album'));
  const [description, setDescription] = useState(text('description'));
  const [tags, setTags] = useState((data.tags ?? []).join('\n'));
  const [tagsEdited, setTagsEdited] = useState(false);
  const [artwork, setArtwork] = useState<MediaFile | null>();
  const [audio, setAudio] = useState<MediaFile>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const live = useRef(true), locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; feedback.busy(false); feedback.notice(); }; }, [feedback]);
  useEffect(() => { feedback.notice(error ? { message: error, reload: conflict ? reload : undefined } : undefined); }, [error, conflict, reload, feedback]);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;

  async function save(deleting: boolean) {
    if (!current() || locked.current || saved || conflict) return;
    locked.current = true;
    feedback.busy(true);
    setBusy(true); setDeleting(deleting); setError(undefined);
    try {
      const pds = createPds(auth);
      const duration = !deleting && audio ? await measureAudioDuration(audio).catch(() => undefined) : undefined;
      if (!current()) return;
      const status = deleting ? await pds.deleteTrack(track.record.uri)
        : await pds.editTrack(track.record.uri, { title, album, description, artwork, audio: audio ? { file: audio, duration } : undefined, tags: tagsEdited ? tags.split('\n') : undefined }, revision);
      if (!current()) return;
      setSaved(true);
      setDeleted(deleting);
      if (status === 'indexed' || status === 'deleted' || status === 'absent') {
        router.replace(deleting ? '/portal' : `/track/${track.id}`);
        return;
      }
      setError(status === 'rejected' ? 'saved to your PDS. the catalog rejected the change.' : 'saved to your PDS. the catalog is catching up.');
    } catch (failure) {
      locked.current = false;
      if (current()) {
        setConflict(failure instanceof TrackRevisionConflict || failure instanceof TrackWriteUnconfirmed);
        setError(failure instanceof Error ? failure.message : 'could not update track.');
      }
    } finally { if (current()) { setBusy(false); feedback.busy(false); } }
  }

  function confirmDelete() {
    Alert.alert(`delete "${track.metadata.title}"?`, 'it comes off your profile and plyr, along with its likes and plays. keep your original file: this cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void save(true) }
    ]);
  }

  function chooseAudio() {
    void pickMedia('audio/*').then(file => {
      if (!file || !current()) return;
      validateReplacementAudio(revision.value, file);
      setAudio(file); setError(undefined);
    }).catch(failure => { if (current()) setError(failure instanceof Error ? failure.message : 'could not open audio.'); });
  }

  const saveLabel = busy && !deleting ? 'Saving…' : 'Save';
  const saveDisabled = busy || conflict || !title.trim() || saved;
  const latestSave = useRef(save);
  latestSave.current = save;
  useEffect(() => { feedback.save({ label: saveLabel, disabled: saveDisabled, onPress: () => void latestSave.current(false) }); }, [feedback, saveLabel, saveDisabled]);
  useEffect(() => () => feedback.save(), [feedback]);

  function changeCover() {
    const choose = () => void pickArtwork().then(file => { if (file && current()) setArtwork(file); })
      .catch(failure => { if (current()) setError(failure instanceof Error ? failure.message : 'could not open cover art.'); });
    if (!cover) return choose();
    Alert.alert('cover', undefined, [
      { text: 'Choose a new cover', onPress: choose },
      { text: 'Remove cover', style: 'destructive', onPress: () => setArtwork(null) },
      { text: 'Cancel', style: 'cancel' }
    ]);
  }

  const theme = useAppearance();
  const picked = usePreviewUri(artwork ?? null);
  const cover = artwork === null ? undefined : picked ?? trackArtwork(track);
  if (saved) return <Action label={deleted ? 'Back to your music' : 'View track'} onPress={() => router.replace(deleted ? '/portal' : `/track/${track.id}`)} />;
  const replaceable = isOpen(track) && canReplaceTrackAudio(revision.value);
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={cover ? 'Change cover' : 'Add a cover'} disabled={busy} onPress={changeCover}
        style={({ pressed }) => ({ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', opacity: pressed ? 0.8 : 1,
          backgroundColor: theme.surface, borderWidth: cover ? 0 : 1, borderStyle: 'dashed', borderColor: theme.line, alignItems: 'center', justifyContent: 'center' })}>
        {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} /> : <ImageSquare size={28} color={theme.faint} />}
        <View style={{ position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0000008c' }}>
          <PencilSimple size={14} color="#ffffff" />
        </View>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      </View>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {!!track.metadata.duration_seconds && <Chip strong label={clock(track.metadata.duration_seconds)} />}
      {audio ? <><Chip label={`new audio · ${audio.name}`} /><Chip label="keep current audio" onPress={busy ? undefined : () => setAudio(undefined)} /></>
        : replaceable && <Chip icon={Waveform} label="replace audio" onPress={busy || conflict ? undefined : chooseAudio} />}
    </View>
    {artwork === null && <Copy>the cover will be removed when you save.</Copy>}
    {audio && <Copy>saving replaces the audio at this track's link. title, likes and playlists stay. keep your original: this can't be undone here.</Copy>}
    {!title.trim() && <FieldError>a track needs a title.</FieldError>}
    <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} placeholder="optional" />
    <TagsField value={tags} onChange={value => { setTags(value); setTagsEdited(true); }} disabled={busy} />
    <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} placeholder="liner notes, credits, lyrics…" style={{ minHeight: 110 }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Delete track" disabled={busy || conflict} onPress={confirmDelete} hitSlop={8}
      style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 14, opacity: busy || conflict ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: theme.danger, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale }}>{busy && deleting ? 'deleting…' : 'delete track'}</Text>
    </Pressable>
  </>;
}
