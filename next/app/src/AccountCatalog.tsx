import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { api, playlistIdFromUri, type AwaitStatus, type ListDetail, type Track } from './api';
import { useAuth } from './auth';
import { getAuth } from './auth-state';
import {
  Button, Detail, Heading, ListRows, Row, Status, TrackRows, artistName, errorMessage, useColors, usePages, useResource, type Play,
} from './CatalogPieces';
import { Action } from './controls';
import { Sheet } from './Sheet';
import { createPds } from './pds';

function usePds() {
  const { did, rpc } = useAuth();
  return useMemo(() => createPds({ did, rpc }), [did, rpc]);
}

function messageFor(status: AwaitStatus, saved = 'Saved to your PDS.') {
  if (status === 'rejected') return 'Saved to your PDS, but the catalog rejected the change.';
  if (status === 'pending') return 'Saved to your PDS. The catalog is catching up.';
  return saved;
}

function useMutation() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function run(action: () => Promise<string>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, message, run };
}

function NameInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const colors = useColors();
  return <TextInput
    accessibilityLabel={label}
    placeholder={label}
    placeholderTextColor={colors.muted}
    value={value}
    onChangeText={onChange}
    maxLength={64}
    style={[styles.input, { color: colors.text, backgroundColor: colors.surface, fontFamily: colors.fontFamily, fontSize: 16 * colors.scale }]}
  />;
}

export function Library({ likesOnly, onPlay }: { likesOnly: boolean; onPlay: Play }) {
  const { ready, did } = useAuth();
  if (!ready) return <Status loading />;
  if (!did) return <>
    {likesOnly && <Heading main>Liked tracks</Heading>}
    <Detail>Sign in to see your liked tracks and playlists.</Detail>
    <View style={styles.actions}><Action primary label="Sign in" href="/login" /></View>
  </>;
  return <AccountLibrary key={did} did={did} likesOnly={likesOnly} onPlay={onPlay} />;
}

function AccountLibrary({ did, likesOnly, onPlay }: { did: string; likesOnly: boolean; onPlay: Play }) {
  const pds = usePds();
  const router = useRouter();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const mutation = useMutation();
  const loadLikes = useCallback((cursor?: string) => api.actorLikes(did, { limit: likesOnly ? 30 : 5, cursor }), [did, likesOnly]);
  const loadLists = useCallback((cursor?: string) => likesOnly
    ? Promise.resolve({ object: 'list' as const, data: [], has_more: false })
    : api.playlists({ owner_did: did, limit: 30, cursor }), [did, likesOnly]);
  const likes = usePages(loadLikes);
  const lists = usePages(loadLists);
  const focus = useRef({ visited: false, active: false });
  const reloadLikes = likes.reload;
  const reloadLists = lists.reload;
  useFocusEffect(useCallback(() => {
    focus.current.active = true;
    if (focus.current.visited) {
      reloadLikes();
      reloadLists();
    }
    focus.current.visited = true;
    return () => { focus.current.active = false; };
  }, [reloadLikes, reloadLists]));
  function create() {
    void mutation.run(async () => {
      const { uri, status } = await pds.createPlaylist(name);
      setCreating(false);
      setName('');
      if (status === 'indexed' && focus.current.active && getAuth().did === did) router.push({ pathname: '/playlist/[id]', params: { id: playlistIdFromUri(uri) } });
      return messageFor(status, 'Playlist created.');
    });
  }
  return <>
    {likesOnly && <Heading main>Liked tracks</Heading>}
    {!likesOnly && <Heading>Liked tracks</Heading>}
    <TrackRows tracks={likes.data} onPlay={onPlay} />
    <Status loading={likes.loading} error={likes.error} retry={likes.more} empty={!likes.data.length ? 'No liked tracks yet.' : undefined} />
    {likesOnly && likes.cursor && !likes.loading && !likes.error && <Button label="More liked tracks" onPress={likes.more} />}
    {!likesOnly && <>
      <Link href="/liked"><Detail>See all liked tracks</Detail></Link>
      <Heading>Playlists</Heading>
      <ListRows lists={lists.data} />
      <Status loading={lists.loading} error={lists.error} retry={lists.more} empty={!lists.data.length ? 'No playlists yet.' : undefined} />
      {lists.cursor && !lists.loading && !lists.error && <Button label="More playlists" onPress={lists.more} />}
      <Link href="/playlists"><Detail>Browse public playlists</Detail></Link>
      {creating ? <Sheet title="New playlist" close={() => { if (!mutation.busy) setCreating(false); }}>
        <NameInput label="Playlist name" value={name} onChange={setName} />
        {!mutation.busy && <View style={styles.actions}>
          {name.trim() && <Button label="Create playlist" onPress={create} />}
          <Button label="Cancel" onPress={() => setCreating(false)} />
        </View>}
      </Sheet> : <Button label="New playlist" onPress={() => setCreating(true)} />}
      <Status loading={mutation.busy} empty={mutation.message} />
    </>}
  </>;
}

export function SignedTrackActions({ track }: { track: Track }) {
  const { did, ready } = useAuth();
  if (!ready) return null;
  if (!did) return <Link href="/login"><Detail>Sign in to like or save</Detail></Link>;
  return <TrackActions key={did} track={track} did={did} />;
}

function TrackActions({ track, did }: { track: Track; did: string }) {
  const pds = usePds();
  const [choosing, setChoosing] = useState(false);
  const [likedOverride, setLikedOverride] = useState<boolean>();
  const likeLoad = useCallback(() => pds.myLikes().then((likes) => likes.has(track.record.uri)), [pds, track.record.uri]);
  const like = useResource(likeLoad);
  const liked = likedOverride ?? like.data;
  const mutation = useMutation();
  function toggle() {
    if (liked === undefined) return;
    void mutation.run(async () => {
      const status = await (liked ? pds.unlike(track) : pds.like(track));
      setLikedOverride(!liked);
      return messageFor(status, liked ? 'Like removed.' : 'Track liked.');
    });
  }
  return <>
    {!mutation.busy && <>
      {liked !== undefined && <Button label={liked ? 'Unlike' : 'Like'} onPress={toggle} />}
      {!choosing && <Button label="Add to playlist" onPress={() => setChoosing(true)} />}
    </>}
    {like.error && liked === undefined && <Status error={like.error} retry={like.retry} />}
    {choosing && <Sheet title="Add to playlist" close={() => setChoosing(false)}><PlaylistPicker did={did} onChoose={(uri) => {
      setChoosing(false);
      void mutation.run(async () => messageFor(await pds.addToPlaylist(uri, track), 'Added to playlist.'));
    }} /></Sheet>}
    <Status loading={mutation.busy} empty={mutation.message} />
  </>;
}

function PlaylistPicker({ did, onChoose }: { did: string; onChoose: (uri: string) => void }) {
  const load = useCallback((cursor?: string) => api.playlists({ owner_did: did, limit: 30, cursor }), [did]);
  const lists = usePages(load);
  return <View style={styles.wide}>
    {lists.data.map((list) => <Button key={list.id} label={list.metadata.name ?? 'Untitled'} onPress={() => onChoose(list.record.uri)} />)}
    <Status loading={lists.loading} error={lists.error} retry={lists.more} empty={!lists.data.length ? 'Create a playlist from your library first.' : undefined} />
    {lists.cursor && !lists.loading && !lists.error && <Button label="More playlists" onPress={lists.more} />}
  </View>;
}

interface CollectionControlsProps {
  list: ListDetail;
  refresh: () => void;
  actions: ReactNode;
  onPlay: Play;
}

export function CollectionActions(props: CollectionControlsProps) {
  const { did } = useAuth();
  if (did && did === props.list.owner.did) return <EditCollection key={did} {...props} />;
  const tracks = props.list.members.flatMap(({ track }) => track ? [track] : []);
  return <>
    <View style={styles.actions}>{props.actions}</View>
    <Heading>Tracks</Heading>
    <TrackRows tracks={tracks} onPlay={props.onPlay} />
  </>;
}

function EditCollection({ list, refresh, actions, onPlay }: CollectionControlsProps) {
  const pds = usePds();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const album = list.object === 'album';
  const [name, setName] = useState(list.metadata.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mutation = useMutation();
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));
  function rename() {
    void mutation.run(async () => {
      const status = await pds.renameCollection(list.record.uri, name, list.object);
      if (status === 'indexed') refresh();
      return messageFor(status, album ? 'Album renamed.' : 'Playlist renamed.');
    });
  }
  function remove(uri: string) {
    void mutation.run(async () => {
      const status = await pds.removeFromPlaylist(list.record.uri, uri);
      if (status === 'indexed') refresh();
      return messageFor(status, 'Track removed.');
    });
  }
  function deletePlaylist() {
    void mutation.run(async () => {
      const status = await pds.deletePlaylist(list.record.uri);
      if ((status === 'deleted' || status === 'absent') && focused.current && getAuth().did === list.owner.did) router.replace('/library');
      setConfirmDelete(false);
      return messageFor(status, 'Playlist deleted.');
    });
  }
  const tracks = list.members.flatMap(({ track }) => track ? [track] : []);
  return <>
    <View style={styles.actions}>
      {actions}
      <Button label={editing ? 'Done editing' : album ? 'Edit album' : 'Edit playlist'}
        onPress={() => {
          if (mutation.busy) return;
          setName(list.metadata.name ?? '');
          setEditing(!editing);
          setConfirmDelete(false);
        }} />
    </View>
    {editing && <View style={styles.group}>
      <NameInput label={album ? 'Album name' : 'Playlist name'} value={name} onChange={setName} />
      <Status loading={mutation.busy} empty={mutation.message} />
      {!mutation.busy && name.trim() && name.trim() !== list.metadata.name &&
        <Button label="Save name" onPress={rename} />}
    </View>}
    <Heading>Tracks</Heading>
    {editing && !album ? list.members.map(({ track, position, subject }) => {
      const removeAction = !mutation.busy && <Button
        label={'Remove ' + (track?.metadata.title ?? 'unavailable track')}
        onPress={() => remove(subject.uri)} />;
      return track ? <Row key={position} href={{ pathname: '/track/[id]', params: { id: track.id } }}
        title={track.metadata.title} subtitle={artistName(track)} image={track.media.artwork?.url} action={removeAction} />
        : <View key={position} style={styles.actions}><Detail>Unavailable track</Detail>{removeAction}</View>;
    }) : <TrackRows tracks={tracks} onPlay={onPlay} />}
    {editing && !album && !mutation.busy && <View style={styles.actions}>
      <Button label={confirmDelete ? 'Confirm delete playlist' : 'Delete playlist'}
        onPress={confirmDelete ? deletePlaylist : () => setConfirmDelete(true)} />
      {confirmDelete && <Button label="Cancel deletion" onPress={() => setConfirmDelete(false)} />}
    </View>}
  </>;
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  wide: { flexBasis: '100%', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: { padding: 13, minHeight: 46, borderRadius: 9 },
});
