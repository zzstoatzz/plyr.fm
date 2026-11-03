import { useState } from 'react';
import { View } from 'react-native';
import { api, type Track } from '../src/api';
import { useAuth } from '../src/auth';
import { Action, Copy, Page, row } from '../src/controls';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export default function Portal() {
  const auth = useAuth();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [notice, setNotice] = useState<string>();

  useFocusEffect(useCallback(() => {
    if (!auth.did) return;
    let live = true;
    setTracks([]);
    void api.tracks({ artist_did: auth.did, limit: 50 }).then((page) => {
      if (live) setTracks(page.data);
    }).catch((error: Error) => { if (live) setNotice(error.message); });
    return () => { live = false; };
  }, [auth.did]));

  return <Page title="Portal">
    {!auth.did ? <Action label="Sign in" href="/login" /> : <>
      <View style={row}><Action label="Upload" href="/upload" /><Action label="Public profile" href={`/u/${auth.handle ?? auth.did}`} /></View>
      <Action label="Edit profile" href="/edit-profile" />
      {notice && <Copy>{notice}</Copy>}
      <Copy>Your tracks</Copy>
      {tracks.map((track) => <View key={track.id} style={row}>
        <Action label={track.metadata.title} href={`/track/${track.id}`} />
        <Action label="Edit" href={`/edit-track/${track.id}`} />
      </View>)}
    </>}
  </Page>;
}
