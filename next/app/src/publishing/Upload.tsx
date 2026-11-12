import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { trackIdFromUri } from '../api';
import { Action, Copy, Field, Page } from '../controls';
import { measureAudioDuration, pickMedia } from '../media-picker';
import { createPds, MAX_AUDIO_BYTES, type MediaFile } from '../pds';
import { TagsField } from './TagsField';

export default function Upload() {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <Page title="upload">
    {!auth.ready ? <Copy>loading your account…</Copy> : !auth.did ? <Action label="Sign in" href={{ pathname: '/login', params: { return_to: '/upload' } }} />
      : <AccountUpload key={`${auth.did}:${session.version}`} auth={auth} />}
  </Page>;
}

function AccountUpload({ auth }: { auth: Auth }) {
  const live = useRef(true);
  const locked = useRef(false);
  const [file, setFile] = useState<MediaFile | null>(null);
  const [artwork, setArtwork] = useState<MediaFile | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [saved, setSaved] = useState<{ uri: string; status: string }>();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;

  async function choose(kind: 'audio/*' | 'image/*') {
    try {
      const item = await pickMedia(kind);
      if (!item || !current()) return;
      if (kind === 'audio/*') {
        if (item.size > MAX_AUDIO_BYTES) throw new Error('audio files are limited to 100 MB.');
        setFile(item);
        if (!title) setTitle(item.name.replace(/\.[^.]+$/, '').slice(0, 256));
      } else setArtwork(item);
    } catch (failure) {
      if (current()) setNote(failure instanceof Error ? failure.message : 'could not open the file.');
    }
  }

  async function upload() {
    if (!current() || !file || locked.current || saved || !title.trim() || !artist.trim()) return;
    locked.current = true;
    setBusy(true);
    setNote(undefined);
    try {
      const duration = await measureAudioDuration(file).catch(() => undefined);
      if (!current()) return;
      const result = await createPds(auth).uploadTrack({ file, artwork, title, artist, album, description, duration, tags: tags.trim() ? tags.split('\n') : undefined });
      if (current()) setSaved(result);
    } catch (failure) {
      if (current()) setNote(failure instanceof Error ? failure.message : 'upload failed.');
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  }

  return saved ? <>
      <Copy>{saved.status === 'indexed' ? 'saved to your PDS.' : 'saved to your PDS. catalog indexing is separate.'}</Copy>
      <Action label="View track" href={`/track/${trackIdFromUri(saved.uri)}`} />
      <Action label="Upload another" onPress={() => {
        setSaved(undefined); setFile(null); setArtwork(null); setTitle(''); setAlbum(''); setDescription(''); setTags('');
      }} />
    </> : <>
      <Copy>audio goes to your PDS. up to 100 MB per track.</Copy>
      <Action label={file?.name ?? 'Choose audio'} onPress={() => void choose('audio/*')} disabled={busy} />
      <Action label={artwork?.name ?? 'Choose cover art'} onPress={() => void choose('image/*')} disabled={busy} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      <Field label="Artist" value={artist} onChangeText={setArtist} maxLength={256} editable={!busy} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} />
      <TagsField value={tags} onChange={setTags} disabled={busy} />
      <Action label={busy ? 'Uploading…' : 'Upload'} onPress={() => void upload()} disabled={busy || !file || !title.trim() || !artist.trim()} />
      {note && <Copy live>{note}</Copy>}
    </>;
}
