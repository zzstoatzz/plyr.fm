import { trackArtwork } from './artwork';
import X from 'lucide-react-native/icons/x';
import { PlayerControl } from './PlayerControl';
import ListPlus from 'lucide-react-native/icons/list-plus';
import Music2 from 'lucide-react-native/icons/eighth-note';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { AccountSection } from './AccountPieces';
import { ActionRow } from './ActionRow';
import { WaveLoading } from './WaveLoading';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { api, playlistIdFromUri, type AwaitStatus, type ListDetail, type Track } from './api';
import { useAuth } from './auth';
import { getAuth } from './auth-state';
import {
  Button, Detail, Heading, ListRows, Row, Status, TrackRows, artistName, errorMessage, usePages, useResource, type Play,
} from './CatalogPieces';
import { Action, Field, InlineLink } from './controls';
import { Sheet } from './Sheet';
import { createPds } from './pds';
import { CreateRecovery, EarlierCreates, useCreateRecovery } from './publishing/CreateRecovery';

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
    <Detail>sign in to see your liked tracks and playlists.</Detail>
    <View style={styles.actions}><Action primary label="Sign in" href="/login" /></View>
  </>;
  return <AccountLibrary key={`${did}:${session.version}`} did={did} likesOnly={likesOnly} onPlay={onPlay} />;
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
  return <>
    <View style={styles.actions}>
      <Action primary icon={ListPlus} label="New playlist" disabled={recovery.loading || !!recovery.error || !!recovery.operations.length} onPress={() => { mutation.clear(); setCreating(true); }} />
      <Action label="Browse playlists" href="/playlists" />
    </View>
    <CreateRecovery auth={auth} recovery={recovery} kind="playlist" onDismiss={() => { setCreated(undefined); mutation.clear(); }} />
    <EarlierCreates auth={auth} recovery={recovery} kind="playlist" />
    {!creating && !recovery.operations.length && <>
      <Status empty={mutation.message} />
      {created && <InlineLink standalone href={{ pathname: '/playlist/[id]', params: { id: playlistIdFromUri(created) } }}>open created playlist</InlineLink>}
    </>}
    <AccountSection title="liked tracks">
      {likedTracks}
      <InlineLink standalone href="/liked">see all liked tracks</InlineLink>
    </AccountSection>
    <AccountSection title="your playlists">
      <ListRows lists={lists.data} />
      <Status loading={lists.loading} error={lists.error} retry={lists.more} empty={!lists.data.length ? 'no playlists yet. make one for your next listen.' : undefined} />
      {lists.cursor && !lists.loading && !lists.error && <Button label="More playlists" onPress={lists.more} />}
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

export function TrackPlaylistPicker({ track }: { track: Track }) {
  const { did } = useAuth();
  const pds = usePds();
  const mutation = useMutation();
  const load = useCallback((cursor?: string) => api.playlists({ owner_did: did ?? undefined, limit: 30, cursor }), [did]);
  const lists = usePages(load);
  return <View style={{ gap: 8 }}>
    {lists.data.map(list => <ActionRow key={list.record.uri} icon={Music2} label={list.metadata.name ?? 'Untitled'} disabled={mutation.busy}
      onPress={() => void mutation.run(async () => messageFor(await pds.addToPlaylist(list.record.uri, track), 'added to playlist.'))} />)}
    {lists.loading && <WaveLoading label="Loading playlists" />}
    {lists.error && <><Detail>{lists.error}</Detail><ActionRow icon={RefreshCw} label="retry" onPress={lists.more} /></>}
    {!lists.loading && !lists.error && !lists.data.length && <Detail>create a playlist from your library first.</Detail>}
    {lists.cursor && !lists.loading && !lists.error && <ActionRow icon={ListPlus} label="more playlists" onPress={lists.more} />}
    {mutation.busy && <Detail>adding to playlist…</Detail>}
    {mutation.message && <Detail>{mutation.message}</Detail>}
  </View>;
}

interface CollectionControlsProps {
  list: ListDetail;
  refresh: () => void;
  actions: ReactNode;
  onPlay: Play;
}

function CollectionBar({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <View style={[styles.actions, width < 520 && { justifyContent: 'center' }]}>{children}</View>;
}

export function CollectionActions(props: CollectionControlsProps) {
  const { did, rpc } = useAuth();
  const [session, setSession] = useState({ rpc, version: 0 });
  if (session.rpc !== rpc) setSession({ rpc, version: session.version + 1 });
  if (did && did === props.list.owner.did) return <EditCollection key={`${did}:${session.version}:${props.list.record.uri}`} {...props} />;
  const tracks = props.list.members.flatMap(({ track }) => track ? [track] : []);
  return <>
    <CollectionBar>{props.actions}</CollectionBar>
    <Heading>tracks</Heading>
    <TrackRows tracks={tracks} onPlay={(track, tracks) => props.onPlay(track, tracks, props.list.metadata.name ?? 'collection')} />
  </>;
}

function EditCollection({ list, refresh, actions, onPlay }: CollectionControlsProps) {
  const auth = useAuth();
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
  return <>
    <CollectionBar>
      {actions}
      <Button label={editing ? 'Done editing' : album ? 'Edit album' : 'Edit playlist'}
        onPress={() => {
          if (mutation.busy) return;
          setName(list.metadata.name ?? '');
          setEditing(!editing);
          setConfirmDelete(false);
        }} />
    </CollectionBar>
    {editing && <View style={styles.group}>
      <NameInput label={album ? 'Album name' : 'Playlist name'} value={name} onChange={setName} />
      <Status loading={mutation.busy} empty={mutation.message} />
      {!mutation.busy && name.trim() && name.trim() !== list.metadata.name &&
        <Button label="Save name" onPress={rename} />}
    </View>}
    <Heading>tracks</Heading>
    {editing && !album ? list.members.map(({ track, position, subject }) => {
      const removeAction = !mutation.busy && <PlayerControl icon={X} destructive
        label={'Remove ' + (track?.metadata.title ?? 'unavailable track')}
        onPress={() => remove(subject.uri)} />;
      return track ? <Row key={position} href={{ pathname: '/track/[id]', params: { id: track.id } }}
        title={track.metadata.title} subtitle={artistName(track)} image={trackArtwork(track)} action={removeAction} />
        : <View key={position} style={styles.actions}><Detail>unavailable track</Detail>{removeAction}</View>;
    }) : <TrackRows tracks={tracks} onPlay={(track, tracks) => onPlay(track, tracks, list.metadata.name ?? 'collection')} />}
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
  input: { padding: 13, minHeight: 46, borderRadius: 9 },
});
