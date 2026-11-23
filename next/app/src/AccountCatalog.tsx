import { AlbumRows, TrackRows } from './TrackRows';
import { trackArtwork } from '@plyr/next-core/artwork';
import { X } from './icons';
import { PlayerControl } from './PlayerControl';
import { AccountSection } from './AccountPieces';
import { PinnedCollection, PlaylistGrid } from './LibraryPieces';
import { loadAll } from '@plyr/next-core/catalog/owned';
import type { ListSummary } from '@plyr/next-core/api';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from './api-client';
import { playlistIdFromUri, type AwaitStatus, type ListDetail, type Track } from '@plyr/next-core/api';
import { useAuth } from './auth';
import { getAuth } from './auth-state';
import {
  Button, Heading, Row, Status, artistName, errorMessage, usePages, useResource, type Play,
} from './CatalogPieces';
import { Action, Field, InlineLink, Copy } from './controls';
import { Sheet } from './Sheet';
import { createPds } from './pds';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './publishing/CreateRecovery';
import { AlbumEditor } from './collections/AlbumEditor';
import { CollectionOrderEditor } from './collections/CollectionOrderEditor';
import { AccessSheet } from './access/AccessSheet';
import type { CollectionRevision } from '@plyr/next-core/collections/collection-order';

function usePds() {
  const { did, rpc } = useAuth();
  return useMemo(() => createPds({ did, rpc }), [did, rpc]);
}

function messageFor(status: AwaitStatus, saved = 'saved to your PDS.') {
  if (status === 'rejected') return 'saved to your PDS, but the catalog rejected the change.';
  if (status === 'pending') return 'saved to your PDS. the catalog is catching up.';
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
  return { busy, message, run, clear: () => setMessage(undefined) };
}

function NameInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <Field label={label} value={value} onChangeText={onChange} maxLength={64} />;
}

export function Library({ likesOnly, onPlay }: { likesOnly: boolean; onPlay: Play }) {
  const { ready, did, rpc } = useAuth();
  const [session, setSession] = useState({ rpc, version: 0 });
  if (session.rpc !== rpc) setSession({ rpc, version: session.version + 1 });
  if (!ready) return <Status loading />;
  if (!did) return <>
    {likesOnly && <Heading main>liked tracks</Heading>}
    <Copy>sign in to see your liked tracks and playlists.</Copy>
    <View style={styles.actions}><Action primary label="Sign in" href="/login" /></View>
  </>;
  return <AccountLibrary key={`${did}:${session.version}`} did={did} likesOnly={likesOnly} onPlay={onPlay} />;
}

type Whole<T> = { items?: T[]; failed?: boolean };
/** a whole collection, re-read on demand; a re-read keeps what is drawn until the new copy lands */
function useWhole<T>(load: () => Promise<T[]>, enabled: boolean) {
  const [value, setValue] = useState<Whole<T>>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then(items => { if (live) setValue({ items }); }, () => { if (live) setValue(previous => ({ items: previous.items, failed: true })); });
    return () => { live = false; };
  }, [load, enabled, version]);
  return { ...value, reload: useCallback(() => setVersion(current => current + 1), []) };
}

function AccountLibrary({ did, likesOnly, onPlay }: { did: string; likesOnly: boolean; onPlay: Play }) {
  const auth = useAuth();
  const pds = usePds();
  const recovery = useCreateRecovery(auth, 'playlist');
  const router = useRouter();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string>();
  const mutation = useMutation();
  const loadLikes = useCallback((cursor?: string) => likesOnly
    ? api.actorLikes(did, { limit: 30, cursor })
    : Promise.resolve({ object: 'list' as const, data: [], has_more: false }), [did, likesOnly]);
  const likes = usePages(loadLikes);
  // the overview reads whole collections: the pinned tiles count, play and shuffle all of them
  const allLikes = useWhole(useCallback(() => loadAll(cursor => api.actorLikes(did, { limit: 100, cursor })), [did]), !likesOnly);
  const uploads = useWhole(useCallback(() => loadAll(cursor => api.tracks({ artist_did: did, limit: 100, cursor })), [did]), !likesOnly);
  const playlists = useWhole<ListSummary>(useCallback(() => loadAll(cursor => api.playlists({ owner_did: did, limit: 100, cursor })), [did]), !likesOnly);
  const focus = useRef({ visited: false, active: false });
  const reloadLikes = likes.reload;
  const reloadAllLikes = allLikes.reload;
  const reloadUploads = uploads.reload;
  const reloadPlaylists = playlists.reload;
  useFocusEffect(useCallback(() => {
    focus.current.active = true;
    if (focus.current.visited) {
      reloadLikes();
      reloadAllLikes();
      reloadUploads();
      reloadPlaylists();
    }
    focus.current.visited = true;
    return () => { focus.current.active = false; };
  }, [reloadLikes, reloadAllLikes, reloadUploads, reloadPlaylists]));
  function create() {
    void mutation.run(async () => {
      try {
        const { uri, status } = await pds.createPlaylist(name);
        if (getAuth().rpc !== auth.rpc) return '';
        setCreating(false); setCreated(uri); setName('');
        if (status === 'indexed' && focus.current.active) router.push({ pathname: '/playlist/[id]', params: { id: playlistIdFromUri(uri) } });
        return messageFor(status, 'playlist created.');
      } finally {
        const pending = await recovery.refresh();
        if (pending.length && getAuth().rpc === auth.rpc) setCreating(false);
      }
    });
  }
  const likedTracks = <>
    <TrackRows tracks={likes.data} onPlay={onPlay} />
    <Status loading={likes.loading} error={likes.error} retry={likes.more} empty={!likes.data.length ? 'no liked tracks yet.' : undefined} />
    {likesOnly && likes.cursor && !likes.loading && !likes.error && <Button label="More liked tracks" onPress={likes.more} />}
  </>;
  if (likesOnly) return <><Heading main>liked tracks</Heading>{likedTracks}</>;
  const newBlocked = recovery.loading || !!recovery.error || !!recovery.operations.length;
  return <>
    <View style={styles.links}><InlineLink href="/playlists">browse playlists</InlineLink></View>
    <View style={styles.pinned}>
      <PinnedCollection liked title="liked tracks" href="/liked" tracks={allLikes.items} failed={allLikes.failed && !allLikes.items} onPlay={onPlay} />
      {uploads.items?.length ? <PinnedCollection title="your uploads" href="/portal" tracks={uploads.items} onPlay={onPlay} /> : null}
    </View>
    <CreateRecovery auth={auth} recovery={recovery} kind="playlist" onDismiss={() => { setCreated(undefined); mutation.clear(); }} />
    <EarlierCreates auth={auth} recovery={recovery} kind="playlist" />
    {!creating && !recovery.operations.length && <>
      <Status empty={mutation.message} />
      {created && <InlineLink standalone href={{ pathname: '/playlist/[id]', params: { id: playlistIdFromUri(created) } }}>open created playlist</InlineLink>}
    </>}
    <AccountSection title={playlists.items ? `playlists · ${playlists.items.length}` : 'playlists'}>
      {playlists.failed && !playlists.items ? <Status error="could not load your playlists." retry={playlists.reload} /> : null}
      <PlaylistGrid lists={playlists.items ?? []} newDisabled={newBlocked} onNew={() => { mutation.clear(); setCreating(true); }} />
    </AccountSection>
    {creating && <Sheet title="new playlist" close={() => { if (!mutation.busy) setCreating(false); }}>
      <Field label="Playlist name" value={name} onChangeText={setName} maxLength={64} editable={!mutation.busy} autoFocus />
      <Status loading={mutation.busy} error={mutation.message} />
      <View style={styles.actions}>
        <Action primary label="Create playlist" disabled={mutation.busy || !name.trim()} onPress={create} />
        <Action label="Cancel" disabled={mutation.busy} onPress={() => setCreating(false)} />
      </View>
    </Sheet>}
  </>;
}

interface CollectionControlsProps {
  list: ListDetail;
  refresh: () => void;
  onPlay: Play;
  onOrderSaved: (revision: CollectionRevision, tracks?: Track[]) => void;
}

function CollectionBar({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <View style={[styles.actions, { justifyContent: 'center' }]}>{children}</View>;
}

export function CollectionActions(props: CollectionControlsProps) {
  const { did, rpc } = useAuth();
  const [session, setSession] = useState({ rpc, version: 0 });
  if (session.rpc !== rpc) setSession({ rpc, version: session.version + 1 });
  if (did && did === props.list.owner.did) return <EditCollection key={`${did}:${session.version}:${props.list.record.uri}`} {...props} />;
  const tracks = props.list.members.flatMap(({ track }) => track ? [track] : []);
  return <CollectionRows list={props.list} tracks={tracks} onPlay={props.onPlay} />;
}

function CollectionRows({ list, tracks, onPlay }: { list: ListDetail; tracks: Track[]; onPlay: Play }) {
  const play: Play = (track, queue) => onPlay(track, queue, list.metadata.name ?? 'collection');
  return list.object === 'album' ? <AlbumRows tracks={tracks} onPlay={play} /> : <TrackRows tracks={tracks} onPlay={play} />;
}

function EditCollection({ list, refresh, onPlay, onOrderSaved }: CollectionControlsProps) {
  const auth = useAuth();
  const pds = usePds();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reordering, setReordering] = useState(false);
  const ordering = useMemo(() => pds.collectionOrder(list.object), [pds, list.object]);
  const album = list.object === 'album';
  const [name, setName] = useState(list.metadata.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [access, setAccess] = useState(false);
  const mutation = useMutation();
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));
  const current = () => focused.current && getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  function rename() {
    void mutation.run(async () => {
      const status = await pds.renameCollection(list.record.uri, name, list.object);
      if (status === 'indexed' && current()) refresh();
      return messageFor(status, album ? 'album renamed.' : 'playlist renamed.');
    });
  }
  function remove(uri: string) {
    void mutation.run(async () => {
      const status = await pds.removeFromPlaylist(list.record.uri, uri);
      if (status === 'indexed' && current()) refresh();
      return messageFor(status, 'track removed.');
    });
  }
  function deletePlaylist() {
    void mutation.run(async () => {
      const status = await pds.deletePlaylist(list.record.uri);
      if ((status === 'deleted' || status === 'absent') && current()) router.replace('/library');
      if (current()) setConfirmDelete(false);
      return messageFor(status, 'playlist deleted.');
    });
  }
  const tracks = list.members.flatMap(({ track }) => track ? [track] : []);
  if (reordering && album) return <AlbumEditor list={list} close={() => setReordering(false)}
    saved={(revision, tracks) => { if (getAuth().did === auth.did && getAuth().rpc === auth.rpc) onOrderSaved(revision, tracks); }} />;
  if (reordering) return <CollectionOrderEditor list={list} ordering={ordering} close={() => setReordering(false)}
    saved={revision => { if (getAuth().did === auth.did && getAuth().rpc === auth.rpc) onOrderSaved(revision); }} />;
  return <>
    <CollectionBar>
      <Button label={editing ? 'Done editing' : album ? 'Edit album' : 'Edit playlist'}
        onPress={() => {
          if (mutation.busy) return;
          setName(list.metadata.name ?? '');
          setEditing(!editing);
          setConfirmDelete(false);
        }} />
      <Button label="Who can listen" onPress={() => setAccess(true)} />
    </CollectionBar>
    {access && <AccessSheet close={() => { setAccess(false); refresh(); }} subject={{ noun: album ? 'album' : 'playlist',
      tracks: list.members.flatMap(({ track }) => track ? [track] : []), skey: list.record.rkey,
      returnTo: `/${album ? 'album' : 'playlist'}/${list.id}` }} />}
    {editing && <View style={styles.group}>
      <NameInput label={album ? 'Album name' : 'Playlist name'} value={name} onChange={setName} />
      <Status loading={mutation.busy} empty={mutation.message} />
      {!mutation.busy && name.trim() && name.trim() !== list.metadata.name &&
        <Button label="Save name" onPress={rename} />}
      {!mutation.busy && <Action label={album ? "Organize tracks" : "Reorder tracks"} onPress={() => setReordering(true)} />}
    </View>}
    {editing && !album ? list.members.map(({ track, position, subject }) => {
      const removeAction = !mutation.busy && <PlayerControl icon={X} destructive
        label={'Remove ' + (track?.metadata.title ?? 'unavailable track')}
        onPress={() => remove(subject.uri)} />;
      return track ? <Row key={position} href={{ pathname: '/track/[id]', params: { id: track.id } }}
        title={track.metadata.title} subtitle={artistName(track)} image={trackArtwork(track)} action={removeAction} />
        : <View key={position} style={styles.actions}><Copy>unavailable track</Copy>{removeAction}</View>;
    }) : <CollectionRows list={list} tracks={tracks} onPlay={onPlay} />}
    {editing && !album && !mutation.busy && <View style={styles.actions}>
      <Button destructive label={confirmDelete ? 'Confirm delete playlist' : 'Delete playlist'}
        onPress={confirmDelete ? deletePlaylist : () => setConfirmDelete(true)} />
      {confirmDelete && <Button label="Cancel deletion" onPress={() => setConfirmDelete(false)} />}
    </View>}
  </>;
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  wide: { flexBasis: '100%', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  links: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -4 },
  pinned: { gap: 10 },
  input: { padding: 13, minHeight: 46, borderRadius: 9 },
});
