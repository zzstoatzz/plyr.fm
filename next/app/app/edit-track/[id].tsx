import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, type Track } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Action, Copy, Field, Page, row } from '../../src/controls';
import { pickMedia } from '../../src/media-picker';
import { createPds, type MediaFile } from '../../src/pds';

export default function EditTrack() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const [track, setTrack] = useState<Track>();
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const [description, setDescription] = useState('');
  const [artwork, setArtwork] = useState<MediaFile | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let live = true;
    void api.track(id).then((value) => {
      if (!live) return;
      setTrack(value);
      setTitle(value.metadata.title);
      setAlbum(value.metadata.album ?? '');
      setDescription(value.metadata.description ?? '');
    }).catch((error: Error) => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [id]);

  async function save(deleting: boolean) {
    if (!track || track.artist.did !== auth.did || busy) return;
    setBusy(true);
    try {
      const pds = createPds(auth);
      if (deleting) await pds.deleteTrack(track.record.uri);
      else await pds.editTrack(track.record.uri, { title, album, description, artwork });
      router.replace(deleting ? '/portal' : `/track/${track.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update track.');
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Edit track">
    {error && <Copy>{error}</Copy>}
    {track && track.artist.did === auth.did ? <>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline />
      <View style={row}>
        <Action label={artwork?.name ?? 'Change cover'} disabled={busy} onPress={() => void pickMedia('image/*').then((file) => {
          if (file) setArtwork(file);
        }).catch(() => setError('Could not open cover art.'))} />
        <Action label={artwork === null ? 'Cover will be removed' : 'Remove cover'} disabled={busy} onPress={() => setArtwork(null)} />
      </View>
      <Action label="Save" disabled={busy || !title.trim()} onPress={() => void save(false)} />
      <Action label={confirm ? 'Confirm delete' : 'Delete track'} disabled={busy} onPress={() => confirm ? void save(true) : setConfirm(true)} />
      {confirm && <Action label="Cancel delete" disabled={busy} onPress={() => setConfirm(false)} />}
    </> : <Copy>{track ? 'Only the artist can edit this track.' : 'Loading track…'}</Copy>}
  </Page>;
}
