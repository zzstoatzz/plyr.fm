import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import type { AwaitStatus } from '@plyr/next-core/api';
import { BIO_GRAPHEMES, blueskyFace, graphemes, shownAvatar, type BlueskyFace } from '@plyr/next-core/profile-avatar';
import { useAppearance } from '../appearance';
import { Cover, useResource } from '../CatalogPieces';
import { Action, Copy, Field } from '../controls';
import { HeroBackdrop } from '../HeroPieces';
import { Camera } from '../icons';
import { createPds, type MediaFile } from '../pds';
import { FieldError } from '../publishing/UploadPieces';
import { BarButton, Sheet } from '../Sheet';
import { Text } from '../Text';
import { WaveLoading } from '../WaveLoading';
import { pickAvatar } from './avatar';

type Profile = Awaited<ReturnType<ReturnType<typeof createPds>['myProfile']>>;
/** `file`: undefined keeps the saved photo, null drops the plyr.fm photo, a file replaces it. */
type Draft = { cid: string; bio: string; file?: MediaFile | null };

const AVATAR = 132;

function close() {
  router.canGoBack() ? router.back() : router.replace('/portal');
}

export function ProfileEditor() {
  const { ready, did, rpc, handle } = useAuth();
  // A Modal outlives its screen losing focus, so the sheet follows the route.
  const focused = useIsFocused();
  const [session, setSession] = useState({ rpc, version: 0 });
  if (session.rpc !== rpc) setSession({ rpc, version: session.version + 1 });
  if (!ready) return <Sheet title="edit profile" close={close} visible={focused}><WaveLoading label="Loading account" /></Sheet>;
  if (!did || !rpc) return <Sheet title="edit profile" close={close} visible={focused}>
    <Copy>sign in to edit your profile.</Copy>
    <Action label="Sign in" onPress={() => router.replace({ pathname: '/login', params: { return_to: '/edit-profile' } })} />
  </Sheet>;
  return <AccountProfileEditor key={`${did}:${session.version}`} did={did} rpc={rpc} handle={handle} />;
}

function AccountProfileEditor({ did, rpc, handle }: { did: NonNullable<Auth['did']>; rpc: NonNullable<Auth['rpc']>; handle: string | null }) {
  const theme = useAppearance();
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const focused = useIsFocused();
  const load = useCallback(() => pds.myProfile(), [pds]);
  const profile = useResource(load);
  const live = useRef(true);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [imageError, setImageError] = useState<string>();
  const [saved, setSaved] = useState<{ status: AwaitStatus; previous: Profile }>();
  const [face, setFace] = useState<BlueskyFace>({});
  const [edits, setEdits] = useState<Draft>();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    blueskyFace(did, controller.signal).then(setFace, () => undefined);
    return () => controller.abort();
  }, [did]);
  const current = () => live.current && getAuth().did === did && getAuth().rpc === rpc;

  const data = profile.data;
  const cid = data?.cid ?? 'new';
  const savedBio = typeof data?.value?.bio === 'string' ? data.value.bio : '';
  // a fresh profile read (after a save) starts a fresh draft
  const draft: Draft = edits?.cid === cid ? edits : { cid, bio: savedBio };
  const update = (change: Partial<Draft>) => setEdits(previous => ({ ...(previous?.cid === cid ? previous : { cid, bio: savedBio }), ...change }));
  const stored = typeof data?.value?.avatar === 'string' && data.value.avatar ? data.value.avatar : undefined;
  const shown = shownAvatar({ picked: draft.file?.uri, cleared: draft.file === null, stored, bluesky: face.avatar });
  const name = (typeof data?.value?.displayName === 'string' && data.value.displayName.trim()) || face.name || handle || '';
  const used = graphemes(draft.bio);
  const tooLong = used > BIO_GRAPHEMES;
  const changed = draft.file !== undefined || draft.bio.trim() !== savedBio;
  const disabled = busy || !!saved;
  const fallback = shown.source === 'new' || shown.source === 'plyr' ? face.avatar ? 'Use my Bluesky photo' : 'Remove photo' : undefined;
  const sourceNote = shown.source === 'new' ? 'new photo, not saved yet'
    : shown.source === 'plyr' ? 'your plyr.fm photo'
      : shown.source === 'bluesky' ? draft.file === null ? 'back to your bluesky photo, not saved yet' : 'showing your bluesky photo'
        : draft.file === null ? 'photo removed, not saved yet' : 'no photo yet';

  function choosePhoto() {
    setImageError(undefined);
    void pickAvatar().then(file => { if (file && current()) update({ file }); })
      .catch(failure => { if (current()) setImageError(failure instanceof Error ? failure.message : 'could not open this image. choose a different photo.'); });
  }

  function changePhoto() {
    if (!fallback) return choosePhoto();
    Alert.alert('photo', undefined, [
      { text: 'Choose a photo', onPress: choosePhoto },
      ...shown.source === 'new' && stored ? [{ text: 'Keep my current photo', onPress: () => { setImageError(undefined); update({ file: undefined }); } }] : [],
      { text: fallback, style: face.avatar ? 'default' : 'destructive', onPress: () => { setImageError(undefined); update({ file: stored ? null : undefined }); } },
      { text: 'Cancel', style: 'cancel' }
    ]);
  }

  async function save() {
    if (locked.current || !current() || !data || !changed || tooLong) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const status = await pds.saveProfile({ bio: draft.bio, ...(draft.file !== undefined ? { avatarFile: draft.file } : {}) }, data);
      if (!current()) return;
      setSaved({ status, previous: data });
      profile.retry();
    } catch (failure) {
      locked.current = false;
      if (current()) setError(failure instanceof Error ? failure.message : 'could not save profile.');
    } finally {
      if (current()) setBusy(false);
    }
  }

  const savedMessage = saved?.status === 'indexed' ? 'profile saved.'
    : saved?.status === 'rejected' ? 'saved to your PDS. the catalog rejected the change.'
      : 'saved to your PDS. the catalog is catching up.';
  const leave = () => { if (!busy) close(); };
  return <Sheet title="edit profile" visible={focused} close={leave} bar={{
    leading: <BarButton label="Cancel" onPress={leave} />,
    trailing: data && !saved ? <BarButton strong label={busy ? 'Saving…' : 'Save'} disabled={busy || !changed || tooLong} onPress={() => void save()} /> : null
  }}>
    {saved && <Copy live>{savedMessage}</Copy>}
    {profile.error ? <>
      <Copy live>{saved ? 'your changes are saved, but the latest profile could not be loaded.' : 'could not load your profile.'}</Copy>
      <Copy>{profile.error}</Copy>
      <Action label="Retry loading profile" onPress={profile.retry} />
    </> : !data ? <WaveLoading label="Loading profile" /> : <>
      <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, gap: 4, alignItems: 'center' }}>
        {shown.url ? <HeroBackdrop uri={shown.url} height={AVATAR + 120} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={shown.url ? 'Change photo' : 'Add a photo'} disabled={disabled} onPress={changePhoto}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, borderRadius: AVATAR / 2, boxShadow: theme.dark ? '0px 10px 30px #0000008c' : '0px 10px 30px #00000038' })}>
          {shown.url && !/^https?:/i.test(shown.url)
            ? <Image source={{ uri: shown.url }} style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }} />
            : <Cover uri={shown.url} size={AVATAR} round />}
          {!disabled && <View style={{ position: 'absolute', right: 2, bottom: 2, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.accent, borderWidth: 3, borderColor: theme.surface }}>
            <Camera size={20} color={theme.onAccent} />
          </View>}
        </Pressable>
        {imageError && <FieldError>{imageError}</FieldError>}
        <Text numberOfLines={2} style={{ marginTop: 12, color: theme.text, fontFamily: theme.fontFamily, fontSize: 28 * theme.scale, lineHeight: 34 * theme.scale, fontWeight: '800', textAlign: 'center' }}>{name}</Text>
        {handle && name !== handle ? <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>@{handle}</Text> : null}
        <View style={{ alignSelf: 'stretch', marginTop: 12, gap: 4 }}>
          <Field label="Bio" value={draft.bio} onChangeText={bio => update({ bio })} multiline editable={!disabled} placeholder="what you make, where you play" />
          {tooLong ? <FieldError>{`${used - BIO_GRAPHEMES} over the ${BIO_GRAPHEMES} character limit`}</FieldError>
            : <Text style={{ alignSelf: 'flex-end', color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontVariant: ['tabular-nums'] }}>{`${used} / ${BIO_GRAPHEMES}`}</Text>}
        </View>
      </View>
      <View style={{ alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: draft.file !== undefined ? theme.accent + '29' : theme.raised }}>
        <Text style={{ color: draft.file !== undefined ? theme.text : theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{sourceNote}</Text>
      </View>
      {saved && data !== saved.previous && <Action label="Edit again" onPress={() => { locked.current = false; setSaved(undefined); setError(undefined); }} />}
    </>}
    {error && <FieldError>{error}</FieldError>}
  </Sheet>;
}
