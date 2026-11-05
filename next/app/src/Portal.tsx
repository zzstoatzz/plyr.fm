import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Pencil from 'lucide-react-native/icons/pencil';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { api, ApiError, type ListSummary, type Page as CatalogPage } from './api';
import { useAuth } from './auth';
import { useAppearance } from './appearance';
import { Action, Copy, Page, row } from './controls';
import { Cover, Detail, Row, usePages, useResource } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';

export function Portal() {
  const auth = useAuth();
  if (!auth.ready) return <Page title="portal"><WaveLoading label="Loading account" /></Page>;
  if (!auth.did) return <Page title="portal">
    <Copy>Sign in to manage your music.</Copy>
    <View style={row}><Action label="sign in" href={{ pathname: '/login', params: { return_to: '/portal' } }} /></View>
  </Page>;
  return <AccountPortal key={auth.did} did={auth.did} handle={auth.handle} />;
}

function AccountPortal({ did, handle }: { did: string; handle: string | null }) {
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks');
  const theme = useAppearance();
  const load = useCallback(async () => {
    try { return await api.artist(did); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }, [did]);
  const artist = useResource(load);
  const name = artist.data?.display_name || handle || 'your music';
  return <Page title="portal">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }}>
      <Cover uri={artist.data?.avatar_url} size={64} round />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={{ color: theme.text, fontSize: 22 * theme.scale, fontWeight: '700' }}>{name}</Text>
        {handle && <Detail>@{handle}</Detail>}
      </View>
    </View>
    <View style={row}>
      <Action label="upload" href="/upload" />
      <Action label="edit profile" href="/edit-profile" />
      <Action label="public profile" href={{ pathname: '/u/[handle]', params: { handle: handle || did } }} />
    </View>
    {artist.error && <View style={row}><Copy>Couldn’t load your profile.</Copy><Action label="retry profile" onPress={artist.retry} /></View>}
    <View accessibilityRole="tablist" style={[row, { paddingTop: 12, borderBottomWidth: 1, borderColor: theme.surface, paddingBottom: 12 }]}>
      <Choice label="tracks" selected={tab === 'tracks'} onPress={() => setTab('tracks')} />
      <Choice label="albums" selected={tab === 'albums'} onPress={() => setTab('albums')} />
    </View>
    {tab === 'tracks' ? <OwnedTracks did={did} /> : <OwnedAlbums did={did} />}
  </Page>;
}

function useFocusedPages<T>(load: (cursor?: string) => Promise<CatalogPage<T>>) {
  const result = usePages(load);
  const visited = useRef(false);
  const reload = result.reload;
  useFocusEffect(useCallback(() => {
    if (visited.current) reload();
    visited.current = true;
  }, [reload]));
  return result;
}

function Refresh({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel="refresh catalog" disabled={disabled} onPress={onPress}
    style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
    <RefreshCw color={theme.muted} size={18} />
  </Pressable>;
}

function OwnedTracks({ did }: { did: string }) {
  const theme = useAppearance();
  const load = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 25, cursor }), [did]);
  const tracks = useFocusedPages(load);
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Detail>your published tracks</Detail><Refresh onPress={tracks.reload} disabled={tracks.loading} />
    </View>
    {tracks.data.map(track => <Row key={track.record.uri} title={track.metadata.title} image={track.media.artwork?.url}
      subtitle={`${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'play' : 'plays'}${track.metadata.album ? ` · ${track.metadata.album}` : ''}`}
      href={{ pathname: '/track/[id]', params: { id: track.id } }}
      action={<Link href={{ pathname: '/edit-track/[id]', params: { id: track.id } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={`edit ${track.metadata.title}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Pencil color={theme.muted} size={18} />
        </Pressable>
      </Link>} />)}
    <CatalogState loading={tracks.loading} error={tracks.error} empty={!tracks.data.length} retry={tracks.cursor ? tracks.more : tracks.reload} />
    {tracks.cursor && !tracks.loading && !tracks.error && <View style={row}><Action label="more tracks" onPress={tracks.more} /></View>}
  </View>;
}

function OwnedAlbums({ did }: { did: string }) {
  const load = useCallback((cursor?: string) => api.albums(did, { cursor, limit: 25 }), [did]);
  const albums = useFocusedPages<ListSummary>(load);
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Detail>your published albums</Detail><Refresh onPress={albums.reload} disabled={albums.loading} />
    </View>
    {albums.data.map(album => <Row key={album.record.uri} title={album.metadata.name || 'untitled album'} image={album.media?.artwork?.url}
      subtitle={`${album.metrics.member_count} ${album.metrics.member_count === 1 ? 'track' : 'tracks'}`}
      href={{ pathname: '/album/[id]', params: { id: album.id } }} />)}
    <CatalogState loading={albums.loading} error={albums.error} empty={!albums.data.length} retry={albums.cursor ? albums.more : albums.reload} />
    {albums.cursor && !albums.loading && !albums.error && <View style={row}><Action label="more albums" onPress={albums.more} /></View>}
  </View>;
}

function CatalogState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty: boolean; retry: () => void }) {
  if (loading) return <WaveLoading label="Loading your music" />;
  if (error) return <View style={{ gap: 10 }}><Copy>{error}</Copy><View style={row}><Action label="retry" onPress={retry} /></View></View>;
  if (empty) return <View style={{ gap: 12, paddingVertical: 20 }}><Copy>No published music here yet.</Copy><View style={row}><Action label="upload a track" href="/upload" /></View></View>;
  return null;
}
