import { trackArtwork, collectionArtwork } from './artwork';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Platform, Pressable, ScrollView, View, type ScrollViewProps, type KeyDownEvent, type ScrollViewInstance, type ViewInstance } from 'react-native';
import Pencil from 'lucide-react-native/icons/pencil';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { api, ApiError, type Artist, type ListSummary } from './api';
import { useAuth } from './auth';
import { useAppearance } from './appearance';
import { Action, Copy, InlineLink, pageFrame, row } from './controls';
import { Cover, Detail, Row, useResource } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';
import { usePortalPages } from './use-portal-pages';
import { ShareLink } from './ShareLink';
import { catalogRevision } from './catalog-changes';

export function Portal() {
  const auth = useAuth();
  if (!auth.ready) return <PortalPage><WaveLoading label="Loading account" /></PortalPage>;
  if (!auth.did) return <PortalPage>
    <Copy>sign in to manage your music.</Copy>
    <View style={row}><Action label="sign in" href={{ pathname: '/login', params: { return_to: '/portal' } }} /></View>
  </PortalPage>;
  return <AccountPortal key={auth.did} did={auth.did} handle={auth.handle} />;
}

function PortalPage({ children, scrollRef, ...props }: {
  children: ReactNode; scrollRef?: Ref<ScrollViewInstance>;
} & Pick<ScrollViewProps, 'onScroll' | 'onContentSizeChange'>) {
  const theme = useAppearance();
  return <ScrollView ref={scrollRef} {...props} scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: theme.background }} contentContainerStyle={{ ...pageFrame, gap: 16, paddingTop: 16, paddingBottom: 32 }}>
    {children}
  </ScrollView>;
}

function AccountPortal({ did, handle }: { did: string; handle: string | null }) {
  const trackTab = useRef<ViewInstance>(null);
  const albumTab = useRef<ViewInstance>(null);
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks');
  const visited = useRef({ tracks: true, albums: false });
  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef({ tracks: 0, albums: 0 });
  const offset = useRef(0);
  const restore = useRef<number | null>(null);
  const focusTab = useRef(false);
  const restoreScroll = useCallback(() => {
    if (restore.current === null) return;
    scroll.current?.scrollTo({ y: restore.current, animated: false });
    restore.current = null;
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      restoreScroll();
      if (focusTab.current) {
        (tab === 'tracks' ? trackTab : albumTab).current?.focus();
        focusTab.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, restoreScroll]);
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
  const tabs = <View accessibilityRole="tablist" accessibilityLabel="Your catalog" {...(Platform.OS === 'web' ? { onKeyDown: (event: KeyDownEvent) => {
      const key = event.nativeEvent.key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
      event.preventDefault();
      const next = key === 'Home' ? 'tracks' : key === 'End' ? 'albums' : tab === 'tracks' ? 'albums' : 'tracks';
      if (next === tab) {
        focusTab.current = false;
        (next === 'tracks' ? trackTab : albumTab).current?.focus();
        return;
      }
      focusTab.current = true;
      selectTab(next);
    } } : {})} style={row}>
      <Choice ref={trackTab} role="tab" label="tracks" selected={tab === 'tracks'} onPress={() => selectTab('tracks')} />
      <Choice ref={albumTab} role="tab" label="albums" selected={tab === 'albums'} onPress={() => selectTab('albums')} />
    </View>;
  return <PortalPage scrollRef={scroll} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} onContentSizeChange={restoreScroll}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 }}>
      <Cover uri={profile?.avatar_url} size={64} round />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={{ color: theme.text, fontSize: 22 * theme.scale, fontWeight: '700' }}>{name}</Text>
        {handle && <Detail>@{handle}</Detail>}
        <InlineLink standalone href={{ pathname: '/u/[handle]', params: { handle: handle || did } }}>view public profile</InlineLink>
      </View>
    </View>
    <View style={row}>
      <Action primary label="upload" href="/upload" />
      <Action label="private music" href="/private" />
      <Action label="edit profile" href="/edit-profile" />
      <ShareLink compact path={'/u/' + (handle || did)} />
    </View>
    {artist.error && <View style={row}><Copy>couldn’t load your profile.</Copy><Action label="retry profile" onPress={artist.retry} /></View>}

    <View style={{ display: tab === 'tracks' ? 'flex' : 'none' }} aria-hidden={tab !== 'tracks'}><OwnedTracks did={did} active={tab === 'tracks'} tabs={tab === 'tracks' ? tabs : null} /></View>
    {visited.current.albums && <View style={{ display: tab === 'albums' ? 'flex' : 'none' }} aria-hidden={tab !== 'albums'}><OwnedAlbums did={did} active={tab === 'albums'} tabs={tab === 'albums' ? tabs : null} /></View>}
  </PortalPage>;
}

function CatalogToolbar({ children, onRefresh, disabled }: { children: ReactNode; onRefresh: () => void; disabled: boolean }) {
  const theme = useAppearance();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: theme.hairline }}>
    <View style={{ flex: 1 }}>{children}</View><Refresh onPress={onRefresh} disabled={disabled} />
  </View>;
}

function Refresh({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel="refresh catalog" disabled={disabled} onPress={onPress}
    style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
    <RefreshCw color={theme.muted} size={18} />
  </Pressable>;
}

function OwnedTracks({ did, active, tabs }: { did: string; active: boolean; tabs: ReactNode }) {
  const theme = useAppearance();
  const load = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 25, cursor }), [did]);
  const tracks = usePortalPages(did, 'tracks', load, active);
  return <View style={{ gap: 8 }}>
    {tabs && <CatalogToolbar onRefresh={tracks.reload} disabled={tracks.loading}>{tabs}</CatalogToolbar>}
    {tracks.data.map(track => <Row key={track.record.uri} title={track.metadata.title} image={trackArtwork(track)}
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

function OwnedAlbums({ did, active, tabs }: { did: string; active: boolean; tabs: ReactNode }) {
  const load = useCallback((cursor?: string) => api.albums(did, { cursor, limit: 25 }), [did]);
  const albums = usePortalPages<ListSummary>(did, 'albums', load, active);
  return <View style={{ gap: 8 }}>
    {tabs && <CatalogToolbar onRefresh={albums.reload} disabled={albums.loading}>{tabs}</CatalogToolbar>}
    {albums.data.map(album => <Row key={album.record.uri} title={album.metadata.name || 'untitled album'} image={collectionArtwork(album)}
      subtitle={`${album.metrics.member_count} ${album.metrics.member_count === 1 ? 'track' : 'tracks'}`}
      href={{ pathname: '/album/[id]', params: { id: album.id } }} />)}
    <CatalogState loading={albums.loading} error={albums.error} empty={!albums.data.length} retry={albums.retry} />
    {albums.cursor && !albums.loading && !albums.error && <View style={row}><Action label="more albums" onPress={albums.more} /></View>}
  </View>;
}

function CatalogState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty: boolean; retry: () => void }) {
  if (loading) return <WaveLoading label="Loading your music" />;
  if (error) return <View style={{ gap: 10 }}><Copy>{error}</Copy><View style={row}><Action label="retry" onPress={retry} /></View></View>;
  if (empty) return <View style={{ gap: 12, paddingVertical: 20 }}><Copy>no published music here yet.</Copy></View>;
  return null;
}
