import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { collectionArtwork } from '@plyr/next-core/artwork';
import { playlistIdFromUri, type ListSummary, type Track } from '@plyr/next-core/api';
import { playlistAddNotice, playlistName, playlistTrackCount, type PlaylistAddStatus } from '@plyr/next-core/collections/playlist-add';
import { useAuth } from '../auth';
import { getAuth } from '../auth-state';
import { Cover, errorMessage } from '../CatalogPieces';
import { ownPlaylists, useOwnPlaylists } from './own-playlists';
import { Copy, inputFontSize } from '../controls';
import { ArrowsClockwise, ListPlus, Plus } from '../icons';
import { ActionRow } from '../ActionRow';
import { CreateRecovery, useCreateRecovery } from '../publishing/CreateRecovery';
import { Text } from '../Text';
import { toast } from '../toast';
import { useAppearance } from '../appearance';
import { WaveLoading } from '../WaveLoading';

/** New playlist first, then the account's playlists. A tap adds, closes the menu and says where the track went. */
export function TrackPlaylistPicker({ track, done }: { track: Track; done: () => void }) {
  const auth = useAuth();
  const theme = useAppearance();
  const recovery = useCreateRecovery(auth, 'playlist');
  const pds = recovery.pds;
  const lists = useOwnPlaylists(auth.did);
  const locked = useRef(false);
  const [adding, setAdding] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const current = () => getAuth().did === auth.did && getAuth().rpc === auth.rpc;
  const blocked = recovery.loading || !!recovery.error || recovery.operations.length > 0;

  function announce(label: string, status: PlaylistAddStatus, id: string, created = false) {
    const notice = playlistAddNotice(label, status, created);
    toast.add(notice.message, notice.tone, notice.tone === 'error' ? 4000 : 5000,
      notice.tone === 'error' ? undefined : { label: 'open', href: { pathname: '/playlist/[id]', params: { id } } });
    done();
  }

  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try { await work(); } catch (failure) {
      if (current()) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (current()) { setBusy(false); setAdding(undefined); }
    }
  }

  const add = (list: ListSummary) => run(async () => {
    setAdding(list.id);
    const status = await pds.addToPlaylist(list.record.uri, track);
    if (auth.did && (status === 'indexed' || status === 'pending')) ownPlaylists.added(auth.did, list.record.uri, track);
    if (current()) announce(playlistName(list), status, list.id);
  });

  const create = () => run(async () => {
    const label = name.trim();
    if (!label || blocked) return;
    try {
      const result = await pds.createPlaylist(label, track);
      if (auth.did) ownPlaylists.created(auth.did, result.uri, label, track);
      if (!current() || result.status !== 'indexed') return;
      const accepted = (await recovery.refresh()).find(operation => operation.uri === result.uri && operation.cid);
      if (accepted) await pds.dismissCreate(accepted).catch(() => {});
      if (current()) announce(label, 'indexed', playlistIdFromUri(result.uri), true);
    } finally { if (current()) await recovery.refresh(); }
  });

  const row = { minHeight: 58, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 7, paddingHorizontal: 4 };
  return <View>
    {creating
      ? <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
        <TextInput accessibilityLabel="playlist name" placeholder="playlist name" placeholderTextColor={theme.muted} value={name} onChangeText={setName}
          maxLength={64} autoFocus editable={!busy} returnKeyType="done" onSubmitEditing={() => void create()}
          style={{ flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.accent,
            color: theme.text, backgroundColor: theme.background, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />
        <Pressable accessibilityRole="button" accessibilityLabel="create & add" accessibilityState={{ disabled: busy || blocked || !name.trim() }}
          disabled={busy || blocked || !name.trim()} onPress={() => void create()}
          style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: theme.accent,
            opacity: busy || blocked || !name.trim() ? 0.5 : pressed ? 0.85 : 1 })}>
          <Text style={{ color: theme.onAccent, fontWeight: '700', fontSize: 15 * theme.scale }}>{busy && !adding ? 'creating…' : 'create & add'}</Text>
        </Pressable>
      </View>
      : <Pressable accessibilityRole="button" accessibilityLabel="new playlist" disabled={busy || blocked} onPress={() => { setError(undefined); setCreating(true); }}
        style={({ pressed }) => ({ ...row, opacity: busy || blocked ? 0.5 : 1, backgroundColor: pressed ? theme.hover : 'transparent', borderRadius: 10 })}>
        <View style={{ width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent + '29' }}>
          <Plus size={20} color={theme.accent} />
        </View>
        <Text style={{ flex: 1, color: theme.accent, fontWeight: '700', fontSize: 16 * theme.scale }}>new playlist</Text>
      </Pressable>}
    {!recovery.loading && (recovery.error || recovery.operations.length > 0) && <CreateRecovery auth={auth} recovery={recovery} kind="playlist" onDismiss={() => {}} />}
    {error && <Copy live>{error}</Copy>}
    <View style={{ height: 1, backgroundColor: theme.hairline, marginVertical: 4 }} />
    {lists.data.map(list => <Pressable key={list.record.uri} accessibilityRole="button" accessibilityLabel={`${playlistName(list)}, ${playlistTrackCount(list)}`} accessibilityState={{ disabled: busy, busy: adding === list.id }} disabled={busy} onPress={() => void add(list)}
      style={({ pressed }) => ({ ...row, opacity: busy && adding !== list.id ? 0.5 : 1, backgroundColor: pressed ? theme.hover : 'transparent', borderRadius: 10 })}>
      <Cover uri={collectionArtwork(list)} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16 * theme.scale }}>{playlistName(list)}</Text>
        <Text style={{ color: theme.faint, fontSize: 13 * theme.scale }}>{playlistTrackCount(list)}</Text>
      </View>
      {adding === list.id ? <ActivityIndicator color={theme.accent} /> : <Plus size={18} color={theme.faint} />}
    </Pressable>)}
    {lists.loading && <WaveLoading label="Loading playlists" />}
    {lists.error && <><Copy>{lists.error}</Copy><ActionRow icon={ArrowsClockwise} label="retry" onPress={() => auth.did && ownPlaylists.retry(auth.did)} /></>}
    {!lists.loading && !lists.error && !lists.data.length && <Copy>no playlists yet. start one above.</Copy>}
    {lists.cursor && !lists.loading && !lists.error && <ActionRow icon={ListPlus} label="more playlists" onPress={() => auth.did && ownPlaylists.more(auth.did)} />}
  </View>;
}
