import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';
import { albumIdFromUri, type Track } from '@plyr/next-core/api';
import { canonicalAudioType, needsPlyrStorage, originalOnPds } from '@plyr/next-core/publishing/upload-queue-model';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { createPds, type MediaFile } from '../pds';
import { useAppearance } from '../appearance';
import { Action, Copy, Field, inputFontSize, Page, row } from '../controls';
import { Text } from '../Text';
import { errorMessage, Status } from '../CatalogPieces';
import { ImageSquare as ImagePlus, PlusCircle, Waveform, X } from '../icons';
import { pickAudioFiles, retype } from '../media-picker';
import { readLocal, removeLocal, writeLocal } from '../storage';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from '../publishing/CreateRecovery';
import { pickArtwork } from '../publishing/artwork';
import { useArtistName } from '../publishing/artist-name';
import { TagsField } from '../publishing/TagsField';
import { CheckRow, FieldError, FormCard, SwitchRow } from '../publishing/UploadPieces';
import { useUploadQueue } from '../publishing/upload-queue';
import { albumProgress, albumUploadCover, finishedAlbum, savedAlbumUpload, startAlbumUpload, subscribeAlbumUploads, type AlbumProgress, type AlbumTrack } from '../publishing/album-uploads';
import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
import { AlbumTracks, OwnTrackSearch } from './AlbumTracks';

export default function CreateAlbum() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="new album">
    {!auth.ready ? <Status loading /> : !auth.did ? <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/create-album' } }} />
      : <NewAlbum key={`${auth.did}:${session.version}`} auth={auth} did={auth.did} />}
  </Page>;
}

function NewAlbum({ auth, did }: { auth: Auth; did: string }) {
  const uploading = useSyncExternalStore(subscribeAlbumUploads, () => savedAlbumUpload(did)?.id);
  const [posted, setPosted] = useState(false);
  const [tracks, setTracks] = useState<AlbumTrack[]>([]);
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState<string>();
  async function choose() {
    try {
      const picked = await pickAudioFiles();
      if (picked.length) { setTracks(value => [...value, ...albumTracks(picked)].slice(0, 500)); setProblem(undefined); }
    } catch (failure) { setProblem(errorMessage(failure)); }
  }
  // when the album is made the saved upload goes away; link the album it became
  const was = useRef(uploading);
  useEffect(() => {
    if (was.current && !uploading) { const uri = finishedAlbum(did); if (uri) setDone(uri); setTracks([]); }
    was.current = uploading;
  }, [uploading, did]);
  if (uploading) return <AlbumUploading auth={auth} />;
  if (done) return <View style={{ gap: 12 }}>
    <Copy live>your album is up.</Copy>
    <View style={row}><Action primary label="View album" href={`/album/${albumIdFromUri(done)}`} /><Action label="New album" onPress={() => setDone(undefined)} /></View>
  </View>;
  if (posted) return <PostedAlbum auth={auth} did={did} back={() => setPosted(false)} />;
  if (!tracks.length) return <View style={{ gap: 18 }}>
    <ChooseFiles onPress={() => void choose()} />
    {problem && <FieldError>{problem}</FieldError>}
    <Pressable accessibilityRole="button" onPress={() => setPosted(true)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
      <PostedLink />
    </Pressable>
  </View>;
  return <AlbumForm auth={auth} tracks={tracks} setTracks={setTracks} addFiles={() => void choose()} problem={problem} />;
}

/** Files in name order, titled by name; a shared "01 " style prefix is dropped since the order already says it. */
function albumTracks(files: MediaFile[]): AlbumTrack[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const bare = sorted.map(file => file.name.replace(/\.[^.]+$/, '').trim());
  const numbered = /^\d{1,3}\s*[-–.)_]?\s+\S/;
  const strip = bare.length > 1 && bare.every(name => numbered.test(name));
  return sorted.map((file, index) => ({
    key: `${file.uri ?? file.name}:${index}:${Date.now()}`,
    file: retype(file, canonicalAudioType(file)),
    title: ((strip ? bare[index].replace(/^\d{1,3}\s*[-–.)_]?\s+/, '') : bare[index]) || file.name).slice(0, 256),
    explicit: false, features: []
  }));
}

function ChooseFiles({ onPress }: { onPress: () => void }) {
  const theme = useAppearance();
  const type = (size: number, weight: '400' | '700' = '400', color = theme.muted) => ({ color, fontFamily: theme.fontFamily, fontSize: size * theme.scale, fontWeight: weight, textAlign: 'center' } as const);
  return <View style={{ alignItems: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 20, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.accent + '73', backgroundColor: theme.surface }}>
    <View style={{ width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent + '29' }}>
      <Waveform size={34} color={theme.accent} />
    </View>
    <Text accessibilityRole="header" style={type(24, '700', theme.text)}>choose your audio files</Text>
    <Text style={type(15)}>open the folder in Files and tap select all. each file becomes a track, in order.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose files" onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 })}>
      <PlusCircle size={20} color={theme.onAccent} />
      <Text style={type(16, '700', theme.onAccent)}>choose files</Text>
    </Pressable>
  </View>;
}

function PostedLink() {
  const theme = useAppearance();
  return <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, textAlign: 'center' }}>
    already posted some of it? <Text style={{ color: theme.accent, fontWeight: '700' }}>add those tracks</Text>
  </Text>;
}

function AlbumHead({ cover, onCover, onRemoveCover, name, setName, artist, disabled }: {
  cover: MediaFile | null; onCover?: () => void; onRemoveCover?: () => void; name: string; setName?: (text: string) => void; artist: string; disabled?: boolean;
}) {
  const theme = useAppearance();
  return <View style={{ alignItems: 'center', gap: 10 }}>
    <View style={{ width: '46%', maxWidth: 220, aspectRatio: 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={cover ? 'Change cover' : 'Choose cover'} onPress={onCover} disabled={disabled || !onCover}
        style={({ pressed }) => ({ flex: 1, borderRadius: 14, overflow: 'hidden', opacity: pressed ? 0.85 : 1,
          ...(cover ? {} : { borderWidth: 2, borderStyle: 'dashed', borderColor: theme.line, backgroundColor: theme.surface }) })}>
        {cover?.uri ? <Image source={{ uri: cover.uri }} style={{ width: '100%', height: '100%' }} />
          : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 }}>
            <ImagePlus size={28} color={theme.faint} />
            <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>add a cover</Text>
            <Text style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>optional</Text>
          </View>}
      </Pressable>
      {cover && onRemoveCover && !disabled && <Pressable accessibilityRole="button" accessibilityLabel="Remove cover" onPress={onRemoveCover} hitSlop={8}
        style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0000008c' }}>
        <X size={16} color="#ffffff" />
      </Pressable>}
    </View>
    {setName ? <TextInput value={name} onChangeText={setName} maxLength={64} accessibilityLabel="Album name" placeholder="name this album" placeholderTextColor={theme.faint}
      editable={!disabled} returnKeyType="done"
      style={{ alignSelf: 'stretch', color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) * 1.6, fontWeight: '700', textAlign: 'center', paddingVertical: 4, borderBottomWidth: 1, borderColor: theme.line }} />
      : <Text accessibilityRole="header" style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 26 * theme.scale, fontWeight: '700', textAlign: 'center' }}>{name}</Text>}
    {!!artist && <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>by {artist}</Text>}
  </View>;
}

function AlbumForm({ auth, tracks, setTracks, addFiles, problem }: {
  auth: Auth; tracks: AlbumTrack[]; setTracks: (update: (value: AlbumTrack[]) => AlbumTrack[]) => void; addFiles: () => void; problem?: string;
}) {
  const theme = useAppearance();
  const artist = useArtistName(auth);
  const [name, setName] = useState('');
  const [cover, setCover] = useState<MediaFile | null>(null);
  const [tags, setTags] = useState('');
  const autoTagKey = `plyr-auto-tag:${auth.did}`;
  const [autoTag, setAutoTag] = useState(() => readLocal(autoTagKey) === 'yes');
  const [inFeeds, setInFeeds] = useState(true);
  const consentKey = `plyr-storage-consent:${auth.did}`;
  const [consent, setConsent] = useState(() => readLocal(consentKey) === 'yes');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const tagError = useMemo(() => { try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return; } catch (failure) { return errorMessage(failure); } }, [tags]);
  const service = tracks.some(track => needsPlyrStorage(track.file));
  const soleCopy = tracks.some(track => needsPlyrStorage(track.file) && !originalOnPds(track.file));
  const blocked = saving || !name.trim() || !artist || !!tagError || tracks.some(track => !track.title.trim()) || (service && (!auth.uploadStorage || (soleCopy && !consent)));
  const update = (index: number, change: Partial<AlbumTrack>) => setTracks(value => value.map((track, position) => position === index ? { ...track, ...change } : track));

  async function upload() {
    if (blocked) return;
    setSaving(true); setError(undefined);
    try {
      if (soleCopy) writeLocal(consentKey, 'yes');
      await startAlbumUpload(auth, artist, name, cover, tracks, { tags: tags.trim() ? tags.split('\n') : undefined, autoTag, inFeeds });
    } catch (failure) { setError(errorMessage(failure)); setSaving(false); }
  }
  return <View style={{ gap: 18 }}>
    <AlbumHead cover={cover} name={name} setName={setName} artist={artist} disabled={saving}
      onCover={() => void pickArtwork().then(item => { if (item) setCover(item); }, failure => setError(errorMessage(failure)))} onRemoveCover={() => setCover(null)} />
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</Text>
      <AlbumTracks disabled={saving} entries={tracks.map(track => ({ key: track.key, title: track.title }))}
        rename={(index, title) => update(index, { title })}
        explicit={tracks.map(track => track.explicit)} toggleExplicit={index => update(index, { explicit: !tracks[index].explicit })}
        move={(index, target) => setTracks(value => { const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; return next; })}
        remove={index => setTracks(value => value.filter((_, position) => position !== index))} />
      <Action icon={PlusCircle} label="Add more files" disabled={saving || tracks.length >= 500} onPress={addFiles} />
      {problem && <FieldError>{problem}</FieldError>}
    </View>
    <FormCard>
      <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>every track</Text>
      <View style={{ gap: 8 }}>
        <TagsField value={tags} onChange={setTags} disabled={saving} />
        {tagError && <FieldError>{tagError}</FieldError>}
      </View>
      <SwitchRow label="auto-tag with recommended genres" detail="we listen once each track is up and add a few genre tags. you can remove them later." value={autoTag} disabled={saving}
        onChange={value => { setAutoTag(value); if (value) writeLocal(autoTagKey, 'yes'); else removeLocal(autoTagKey); }} />
      <SwitchRow label="show in feeds" detail="off keeps the tracks out of latest and top. they stay on your profile and in search." value={inFeeds} onChange={setInFeeds} disabled={saving} />
      <Copy>albums are open to everyone, and anyone can download the tracks.</Copy>
    </FormCard>
    {service && <FormCard>
      {soleCopy ? <>
        <CheckRow label="use plyr.fm storage" checked={consent} onChange={setConsent} />
        <Copy>files over 100 MB are more than a track can keep on your PDS, so plyr.fm keeps those. playback and downloads are public.</Copy>
      </> : <Copy>your PDS keeps the originals. plyr.fm adds an mp3 copy where needed so they play everywhere.</Copy>}
      {!auth.uploadStorage && <><Copy>sign in again to allow plyr.fm storage. you will choose the files again.</Copy><Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/create-album' } }} /></>}
    </FormCard>}
    {error && <FieldError>{error}</FieldError>}
    <Action primary label={saving ? 'Starting…' : 'Upload album'} disabled={blocked} onPress={() => void upload()} />
    <Copy>by uploading you confirm you have the rights to share these. you can keep browsing while it uploads.</Copy>
  </View>;
}

function AlbumUploading({ auth }: { auth: Auth }) {
  const theme = useAppearance();
  const artist = useArtistName(auth);
  const queue = useUploadQueue();
  const [progress, setProgress] = useState<AlbumProgress>();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const tick = queue.map(job => `${job.id}:${job.phase}:${Math.floor((job.progress ?? 0) * 20)}`).join();
  useEffect(() => { void albumProgress(auth).then(value => { if (live.current) setProgress(value); }, () => undefined); }, [tick, auth]);
  if (!progress) return <Status loading />;
  const finished = progress.slots.filter(item => item.state === 'done').length;
  return <View style={{ gap: 16 }}>
    <AlbumHead cover={albumUploadCover(progress.plan) ?? null} name={progress.plan.name} artist={artist} />
    <Copy live>uploading {Math.min(finished + 1, progress.slots.length)} of {progress.slots.length}. you can leave this screen; the album is made when the last track is up.</Copy>
    <View style={{ gap: 6 }}>{progress.slots.map(({ slot, state, detail }, index) => <View key={slot.id}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}>
      <Text style={{ width: 22, color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, textAlign: 'right' }}>{index + 1}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: state === 'waiting' ? theme.muted : theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>{slot.title}</Text>
        {state !== 'waiting' && state !== 'done' && !!detail && <Text style={{ color: state === 'stopped' ? theme.muted : theme.muted, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>{detail}</Text>}
      </View>
      <Text style={{ color: state === 'done' ? theme.accent : theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontWeight: '700' }}>{state === 'done' ? 'up' : state === 'working' ? '…' : ''}</Text>
    </View>)}</View>
  </View>;
}

function PostedAlbum({ auth, did, back }: { auth: Auth; did: string; back: () => void }) {
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
    } catch (failure) { if (current()) setError(errorMessage(failure)); }
    finally { await recovery.refresh(); locked.current = false; if (current()) setBusy(false); }
  }
  return <View style={{ gap: 16 }}>
    <CreateRecovery auth={auth} recovery={recovery} kind="album" onDismiss={() => { setCreated(undefined); setName(''); setTracks([]); setError(undefined); }} />
    <EarlierCreates auth={auth} recovery={recovery} kind="album" />
    <Field label="Album name" value={name} onChangeText={setName} maxLength={64} editable={!blocked} />
    <AlbumTracks entries={tracks.map(track => ({ key: track.record.uri, title: track.metadata.title }))} disabled={blocked}
      move={(index, target) => setTracks(value => { const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; return next; })}
      remove={index => setTracks(value => value.filter((_, position) => index !== position))} />
    <OwnTrackSearch did={did} selected={tracks.map(track => track.record.uri)} disabled={blocked || tracks.length >= 500} add={track => setTracks(value => [...value, track])} />
    <Status loading={busy} error={error} />
    <View style={row}>
      <Action primary label="Make the album" disabled={blocked || !name.trim() || !tracks.length} onPress={() => void create()} />
      {!created && <Action label="Upload files instead" onPress={back} />}
    </View>
    {created && !recovery.operations.length && <Action label="View album" href={`/album/${albumIdFromUri(created)}`} />}
  </View>;
}
