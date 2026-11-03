import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api, type Track } from '../src/api';
import { useAuth } from '../src/auth';
import { Action, Copy, Field, Page, row } from '../src/controls';
import { createPds } from '../src/pds';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export default function Portal() {
  const auth = useAuth();
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof pds.myProfile>>>();
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth.did) return;
    let live = true;
    setProfile(undefined);
    void pds.myProfile().then((current) => {
      if (!live) return;
      setProfile(current);
      setBio(current.value?.bio ?? '');
      setAvatar(current.value?.avatar ?? '');
    }).catch((error: Error) => { if (live) setNotice(error.message); });
    return () => { live = false; };
  }, [auth.did, pds]);

  useFocusEffect(useCallback(() => {
    if (!auth.did) return;
    let live = true;
    setTracks([]);
    void api.tracks({ artist_did: auth.did, limit: 50 }).then((page) => {
      if (live) setTracks(page.data);
    }).catch((error: Error) => { if (live) setNotice(error.message); });
    return () => { live = false; };
  }, [auth.did]));

  async function save() {
    if (!profile || busy) return;
    if (avatar.trim() && !avatar.trim().startsWith('https://')) {
      setNotice('Use an HTTPS avatar URL.');
      return;
    }
    setBusy(true);
    try {
      await pds.saveProfile({ bio, avatar }, profile);
      setProfile(await pds.myProfile());
      setNotice('Profile saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Portal">
    {!auth.did ? <Action label="Sign in" href="/login" /> : <>
      <View style={row}><Action label="Upload" href="/upload" /><Action label="Public profile" href={`/u/${auth.handle ?? auth.did}`} /></View>
      <Field label="Bio" value={bio} onChangeText={setBio} multiline />
      <Field label="Avatar URL" value={avatar} onChangeText={setAvatar} autoCapitalize="none" />
      <Action label="Save profile" disabled={!profile || busy} onPress={() => void save()} />
      {notice && <Copy>{notice}</Copy>}
      <Copy>Your tracks</Copy>
      {tracks.map((track) => <View key={track.id} style={row}>
        <Action label={track.metadata.title} href={`/track/${track.id}`} />
        <Action label="Edit" href={`/edit-track/${track.id}`} />
      </View>)}
    </>}
  </Page>;
}
