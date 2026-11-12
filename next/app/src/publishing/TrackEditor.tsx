import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { getAuth, type Auth } from '../auth-state';
import { useResource } from '../CatalogPieces';
import { Sheet } from '../Sheet';
import { Action, Copy, Field, row } from '../controls';
import { pickMedia } from '../media-picker';
import { createPds, TrackRevisionConflict, type MediaFile } from '../pds';
import { recordTags } from './track-tags';
import { TagsField } from './TagsField';

function close(id: string) { router.canGoBack() ? router.back() : router.replace(`/track/${id}`); }

export function TrackEditor({ id }: { id: string }) {
  const auth = useAuth();
  const [session, setSession] = useState({ rpc: auth.rpc, version: 0 });
  if (session.rpc !== auth.rpc) setSession({ rpc: auth.rpc, version: session.version + 1 });
  return <EditorSession key={`${id}:${auth.did}:${session.version}`} id={id} auth={auth} />;
}

function EditorSession({ id, auth }: { id: string; auth: Auth }) {
  const pds = useMemo(() => createPds(auth), [auth.did, auth.rpc]);
  const load = useCallback(async () => {
    const track = await api.track(id);
    if (track.artist.did !== auth.did) throw new Error('only the artist can edit this track.');
    const revision = await pds.myTrack(track.record.uri);
    return { track, revision, tags: recordTags(revision.value.tags) };
  }, [id, auth.did, pds]);
  const resource = useResource(load);
  if (resource.data) return <TrackForm key={resource.data.revision.cid} auth={auth} data={resource.data} reload={resource.retry} />;
  return <Sheet title="edit track" close={() => close(id)}>
    {resource.error ? <><Copy live>{resource.error}</Copy><Action label="Retry loading track" onPress={resource.retry} /></>
      : <Copy>loading track…</Copy>}
  </Sheet>;
}

type Data = { track: Awaited<ReturnType<typeof api.track>>; revision: Awaited<ReturnType<ReturnType<typeof createPds>['myTrack']>>; tags?: string[] };

function TrackForm({ auth, data, reload }: { auth: Auth; data: Data; reload: () => void }) {
  const { track, revision } = data;
  const text = (key: string) => typeof revision.value[key] === 'string' ? revision.value[key] : '';
  const [title, setTitle] = useState(text('title'));
  const [album, setAlbum] = useState(text('album'));
  const [description, setDescription] = useState(text('description'));
  const [tags, setTags] = useState((data.tags ?? []).join('\n'));
  const [tagsEdited, setTagsEdited] = useState(false);
  const [artwork, setArtwork] = useState<MediaFile | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const live = useRef(true), locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = () => live.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;

  async function save(deleting: boolean) {
    if (!current() || locked.current || saved || conflict) return;
    locked.current = true;
    setBusy(true); setError(undefined);
    try {
      const pds = createPds(auth);
      const status = deleting ? await pds.deleteTrack(track.record.uri)
        : await pds.editTrack(track.record.uri, { title, album, description, artwork, tags: tagsEdited ? tags.split('\n') : undefined }, revision);
      if (!current()) return;
      setSaved(true);
      setDeleted(deleting);
      if (status === 'indexed' || status === 'deleted' || status === 'absent') {
        router.replace(deleting ? '/portal' : `/track/${track.id}`);
        return;
      }
      setError(status === 'rejected' ? 'saved to your PDS. the catalog rejected the change.' : 'saved to your PDS. the catalog is catching up.');
    } catch (failure) {
      locked.current = false;
      if (current()) {
        setConflict(failure instanceof TrackRevisionConflict);
        setError(failure instanceof Error ? failure.message : 'could not update track.');
      }
    } finally { if (current()) setBusy(false); }
  }

  return <Sheet title="edit track" close={() => { if (!busy) close(track.id); }}>
    {error && <Copy live>{error}</Copy>}
    {conflict && <Action label="Discard draft and reload" onPress={reload} />}
    {saved ? <Action label={deleted ? 'Back to your music' : 'View track'} onPress={() => router.replace(deleted ? '/portal' : `/track/${track.id}`)} /> : <>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!busy} />
      <Field label="Album" value={album} onChangeText={setAlbum} maxLength={256} editable={!busy} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy} />
      <TagsField value={tags} onChange={value => { setTags(value); setTagsEdited(true); }} disabled={busy} />
      <View style={row}>
        <Action label={artwork?.name ?? 'Change cover'} disabled={busy} onPress={() => void pickMedia('image/*').then(file => {
          if (file && current()) setArtwork(file);
        }).catch(() => { if (current()) setError('could not open cover art.'); })} />
        <Action label={artwork === null ? 'cover will be removed' : 'remove cover'} disabled={busy} onPress={() => setArtwork(null)} />
      </View>
      <Action primary label="Save" disabled={busy || conflict || !title.trim()} onPress={() => void save(false)} />
      <Action destructive label={confirm ? 'Confirm delete' : 'Delete track'} disabled={busy || conflict} onPress={() => confirm ? void save(true) : setConfirm(true)} />
      {confirm && <Action label="Cancel delete" disabled={busy} onPress={() => setConfirm(false)} />}
    </>}
  </Sheet>;
}
