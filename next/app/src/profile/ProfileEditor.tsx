import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import type { AwaitStatus } from '../api';
import { useResource } from '../CatalogPieces';
import { Action, Copy, Field, row } from '../controls';
import { createPds } from '../pds';
import { Sheet } from '../Sheet';
import { WaveLoading } from '../WaveLoading';

type Profile = Awaited<ReturnType<ReturnType<typeof createPds>['myProfile']>>;
type Edits = Parameters<ReturnType<typeof createPds>['saveProfile']>[0];

function validAvatar(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !!url.hostname;
  } catch { return false; }
}

function close() {
  router.canGoBack() ? router.back() : router.replace('/portal');
}

export function ProfileEditor() {
  const { ready, did, rpc } = useAuth();
  const [session, setSession] = useState({ rpc, version: 0 });
  if (session.rpc !== rpc) setSession({ rpc, version: session.version + 1 });
  if (!ready) return <Sheet title="edit profile" close={close}><WaveLoading label="Loading account" /></Sheet>;
  if (!did || !rpc) return <Sheet title="edit profile" close={close}>
    <Copy>sign in to edit your profile.</Copy>
    <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/edit-profile' } }} />
  </Sheet>;
  return <AccountProfileEditor key={`${did}:${session.version}`} did={did} rpc={rpc} />;
}

function AccountProfileEditor({ did, rpc }: { did: NonNullable<Auth['did']>; rpc: NonNullable<Auth['rpc']> }) {
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const load = useCallback(() => pds.myProfile(), [pds]);
  const profile = useResource(load);
  const live = useRef(true);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ status: AwaitStatus; previous: Profile }>();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === did && getAuth().rpc === rpc;

  async function save(edits: Edits, revision: Profile) {
    if (locked.current || !current()) return;
    if (!validAvatar(edits.avatar)) {
      setError('use an HTTPS avatar URL.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const status = await pds.saveProfile(edits, revision);
      if (!current()) return;
      setSaved({ status, previous: revision });
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
  return <Sheet title="edit profile" close={() => { if (!busy) close(); }}>
    {saved && <Copy live>{savedMessage}</Copy>}
    {profile.error ? <>
      <Copy live>{saved ? 'your changes are saved, but the latest profile could not be loaded.' : 'could not load your profile.'}</Copy>
      <Copy>{profile.error}</Copy>
      <Action label="Retry loading profile" onPress={profile.retry} />
    </> : !profile.data ? <WaveLoading label="Loading profile" /> : <>
      <ProfileForm key={profile.data.cid ?? 'new'} profile={profile.data} disabled={busy || !!saved} busy={busy} save={save} />
      {saved && profile.data !== saved.previous && <Action label="Edit again" onPress={() => { locked.current = false; setSaved(undefined); setError(undefined); }} />}
    </>}
    {error && <Copy live>{error}</Copy>}
  </Sheet>;
}

function ProfileForm({ profile, disabled, busy, save }: { profile: Profile; disabled: boolean; busy: boolean; save: (edits: Edits, revision: Profile) => Promise<void> }) {
  const [bio, setBio] = useState(profile.value?.bio ?? '');
  const [avatar, setAvatar] = useState(profile.value?.avatar ?? '');
  const changed = bio.trim() !== (profile.value?.bio ?? '') || avatar.trim() !== (profile.value?.avatar ?? '');
  return <>
    <Field label="Bio" value={bio} onChangeText={setBio} multiline editable={!disabled} />
    <Field label="Avatar URL" value={avatar} onChangeText={setAvatar} autoCapitalize="none" autoCorrect={false} editable={!disabled} />
    {!disabled || busy ? <View style={row}>
      <Action primary label={busy ? 'Saving…' : 'Save profile'} disabled={disabled || !changed} onPress={() => void save({ bio, avatar }, profile)} />
    </View> : null}
  </>;
}
