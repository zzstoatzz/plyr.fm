import { useState } from 'react';
import { useAuth } from '../src/auth';
import { trackIdFromUri } from '../src/api';
import { Action, Copy, Field, Page } from '../src/controls';
import { pickMedia } from '../src/media-picker';
import { createPds, MAX_AUDIO_BYTES, type MediaFile } from '../src/pds';

export default function Upload() {
  const auth = useAuth();
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [saved, setSaved] = useState<{ uri: string; status: string }>();

  async function choose(kind: 'audio/*' | 'image/*') {
    try {
      const item = await pickMedia(kind);
      if (!item) return;
      if (kind === 'audio/*') {
        if (item.size > MAX_AUDIO_BYTES) throw new Error('Audio files are limited to 100 MB.');
        setFile(item);
        if (!title) setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
      } else setArtwork(item);
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'Could not open the file.');
    }
  }

  async function upload() {
    if (!file || busy || saved || !title.trim() || !artist.trim()) return;
    setBusy(true);
    setNote(undefined);
    try {
      setSaved(await createPds(auth).uploadTrack({ file, artwork, title, artist, album, description }));
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Upload">
    {!auth.did ? <Action label="Sign in" href="/login" /> : saved ? <>
      <Copy>{saved.status === 'indexed' ? 'Saved to your PDS.' : 'Saved to your PDS. Catalog indexing is separate.'}</Copy>
      <Action label="View track" href={`/track/${trackIdFromUri(saved.uri)}`} />
      <Action label="Upload another" onPress={() => {
        setSaved(undefined); setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription('');
      }} />
    </> : <>
      <Copy>Audio goes to your PDS.</Copy>
      <Action label={file?.name ?? 'Choose audio'} onPress={() => void choose('audio/*')} disabled={busy} />
      <Action label={artwork?.name ?? 'Choose cover art'} onPress={() => void choose('image/*')} disabled={busy} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline />
      <Action label={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !file || !title.trim() || !artist.trim()} />
      {note && <Copy>{note}</Copy>}
    </>}
  </Page>;
}
