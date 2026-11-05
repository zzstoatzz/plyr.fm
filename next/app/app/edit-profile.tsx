import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../src/auth';
import { Action, Copy, Field } from '../src/controls';
import { createPds } from '../src/pds';
import { Sheet } from '../src/Sheet';

export default function EditProfile() {
  const { did, rpc } = useAuth();
  const pds = useMemo(() => createPds({ did, rpc }), [did, rpc]);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof pds.myProfile>>>();
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProfile(undefined);
    if (!did) return;
    let live = true;
    void pds.myProfile().then((data) => {
      if (!live) return;
      setProfile(data);
      setBio(data.value?.bio ?? '');
      setAvatar(data.value?.avatar ?? '');
    }).catch((error: Error) => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, [did, pds]);

  async function save() {
    if (!profile || busy) return;
    if (avatar.trim() && !avatar.trim().startsWith('https://')) {
      setMessage('Use an HTTPS avatar URL.');
      return;
    }
    setBusy(true);
    try {
      const status = await pds.saveProfile({ bio, avatar }, profile);
      setMessage(status === 'indexed' ? 'Profile saved.' : 'Saved to your PDS. Check your public profile after indexing.');
      setProfile(await pds.myProfile());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  return <Sheet title="Edit profile" close={() => {
    if (!busy) router.canGoBack() ? router.back() : router.replace('/portal');
  }}>
    {!did ? <Copy>Sign in to edit your profile.</Copy> : <>
      <Field label="Bio" value={bio} onChangeText={setBio} multiline editable={!busy && !!profile} />
      <Field label="Avatar URL" value={avatar} onChangeText={setAvatar} autoCapitalize="none" editable={!busy && !!profile} />
      <Action primary label={busy ? 'Saving…' : 'Save profile'} disabled={!profile || busy} onPress={() => void save()} />
    </>}
    {message && <Copy live>{message}</Copy>}
  </Sheet>;
}
