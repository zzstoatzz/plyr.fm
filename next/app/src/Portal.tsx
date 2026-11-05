import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View, type ScrollViewInstance } from 'react-native';
import Pencil from 'lucide-react-native/icons/pencil';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { api, ApiError, type Artist, type ListSummary } from './api';
import { useAuth } from './auth';
import { useAppearance } from './appearance';
import { Action, Copy, Page, row } from './controls';
import { Cover, Detail, Row, useResource } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';
import { usePortalPages } from './use-portal-pages';
import { catalogRevision } from './catalog-changes';

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
  const visited = useRef({ tracks: true, albums: false });
  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef({ tracks: 0, albums: 0 });
  const offset = useRef(0);
  const restore = useRef<number | null>(null);
  const restoreScroll = useCallback(() => {
    if (restore.current === null) return;
    scroll.current?.scrollTo({ y: restore.current, animated: false });
    restore.current = null;
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(restoreScroll); return () => cancelAnimationFrame(frame); }, [tab, restoreScroll]);
  const selectTab = (next: typeof tab) => {
    if (next === tab) return;
    positions.current[tab] = offset.current;
    visited.current[next] = true;
    restore.current = positions.current[next];
    setTab(next);
  };
  const theme = useAppearance();
  const load = useCallback(async () => {
    try { return await api.artist(did); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }, [did]);
  const artist = useResource(load, 0, true);
  const lastArtist = useRef<Artist | null | undefined>(undefined);
  if (artist.data !== undefined) lastArtist.current = artist.data;
  const profile = artist.data ?? lastArtist.current;
  const profileRevision = useRef(catalogRevision(did, 'profile'));
  useFocusEffect(useCallback(() => {
    const revision = catalogRevision(did, 'profile');
    if (revision !== profileRevision.current) { profileRevision.current = revision; artist.retry(); }
  }, [did, artist.retry]));
  const name = profile?.display_name || handle || 'your music';
  return <Page title="portal" scrollRef={scroll} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} onContentSizeChange={restoreScroll}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }}>
      <Cover uri={profile?.avatar_url} size={64} round />
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
      <Choice role="tab" label="tracks" selected={tab === 'tracks'} onPress={() => selectTab('tracks')} />
      <Choice role="tab" label="albums" selected={tab === 'albums'} onPress={() => selectTab('albums')} />
    </View>
    <View style={{ display: tab === 'tracks' ? 'flex' : 'none' }} aria-hidden={tab !== 'tracks'}><OwnedTracks did={did} active={tab === 'tracks'} /></View>
    {visited.current.albums && <View style={{ display: tab === 'albums' ? 'flex' : 'none' }} aria-hidden={tab !== 'albums'}><OwnedAlbums did={did} active={tab === 'albums'} /></View>}
  </Page>;
}

function Refresh({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel="refresh catalog" disabled={disabled} onPress={onPress}
    style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
    <RefreshCw color={theme.muted} size={18} />
  </Pressable>;
}

function OwnedTracks({ did, active }: { did: string; active: boolean }) {
  const theme = useAppearance();
  const load = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 25, cursor }), [did]);
  const tracks = usePortalPages(did, 'tracks', load, active);
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
    <CatalogState loading={tracks.loading} error={tracks.error} empty={!tracks.data.length} retry={tracks.retry} />
    {tracks.cursor && !tracks.loading && !tracks.error && <View style={row}><Action label="more tracks" onPress={tracks.more} /></View>}
  </View>;
}

function OwnedAlbums({ did, active }: { did: string; active: boolean }) {
  const load = useCallback((cursor?: string) => api.albums(did, { cursor, limit: 25 }), [did]);
  const albums = usePortalPages<ListSummary>(did, 'albums', load, active);
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Detail>your published albums</Detail><Refresh onPress={albums.reload} disabled={albums.loading} />
    </View>
    {albums.data.map(album => <Row key={album.record.uri} title={album.metadata.name || 'untitled album'} image={album.media?.artwork?.url}
      subtitle={`${album.metrics.member_count} ${album.metrics.member_count === 1 ? 'track' : 'tracks'}`}
      href={{ pathname: '/album/[id]', params: { id: album.id } }} />)}
    <CatalogState loading={albums.loading} error={albums.error} empty={!albums.data.length} retry={albums.retry} />
    {albums.cursor && !albums.loading && !albums.error && <View style={row}><Action label="more albums" onPress={albums.more} /></View>}
  </View>;
}

function CatalogState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty: boolean; retry: () => void }) {
  if (loading) return <WaveLoading label="Loading your music" />;
  if (error) return <View style={{ gap: 10 }}><Copy>{error}</Copy><View style={row}><Action label="retry" onPress={retry} /></View></View>;
  if (empty) return <View style={{ gap: 12, paddingVertical: 20 }}><Copy>No published music here yet.</Copy><View style={row}><Action label="upload a track" href="/upload" /></View></View>;
  return null;
}
