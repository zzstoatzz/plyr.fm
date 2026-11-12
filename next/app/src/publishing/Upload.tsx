import { useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { trackIdFromUri } from '../api';
import { Action, Copy, Field, Page } from '../controls';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { createPds, MAX_AUDIO_BYTES, type MediaFile } from '../pds';

export default function Upload() {
  const auth = useAuth();
  return <Page title="upload">
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <Action label="Sign in" href="/login" />
      : <AccountUpload key={auth.did} auth={auth} />}
  </Page>;
}

function AccountUpload({ auth }: { auth: Auth }) {
  const locked = useRef(false);
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
      if (!item || getAuth().agent !== auth.agent) return;
      if (kind === 'audio/*') {
        if (item.size > MAX_AUDIO_BYTES) throw new Error('audio files are limited to 100 MB.');
        setFile(item);
        if (!title) setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
      } else setArtwork(item);
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'could not open the file.');
    }
  }

  async function upload() {
    if (!file || locked.current || saved || !title.trim() || !artist.trim()) return;
    locked.current = true;
    setBusy(true);
    setNote(undefined);
    try {
      const duration = await measureAudioDuration(file).catch(() => undefined);
      if (getAuth().agent !== auth.agent) throw new Error('account changed before upload.');
      setSaved(await createPds(auth).uploadTrack({ file, artwork, title, artist, album, description, duration }));
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : 'upload failed.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return saved ? <>
      <Copy>{saved.status === 'indexed' ? 'saved to your PDS.' : 'saved to your PDS. catalog indexing is separate.'}</Copy>
      <Action label="View track" href={`/track/${trackIdFromUri(saved.uri)}`} />
      <Action label="Upload another" onPress={() => {
        setSaved(undefined); setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription('');
      }} />
    </> : <>
      <Copy>audio goes to your PDS. up to 100 MB per track.</Copy>
      <Action label={file?.name ?? 'Choose audio'} onPress={() => void choose('audio/*')} disabled={busy} />
      <Action label={artwork?.name ?? 'Choose cover art'} onPress={() => void choose('image/*')} disabled={busy} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} editable={!busy} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} />
      <Action label={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !file || !title.trim() || !artist.trim()} />
      {note && <Copy live>{note}</Copy>}
    </>;
}
