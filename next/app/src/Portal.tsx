import { trackArtwork, collectionArtwork } from '@plyr/next-core/artwork';
import { CaretRight as ChevronRight, PencilSimple as Pencil, Trash } from './icons';
import { Link, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type ScrollViewInstance } from 'react-native';
import { api } from './api-client';
import { ApiError, type Artist, type Page, type ListSummary, type Track } from '@plyr/next-core/api';
import { useAuth } from './auth';
import { useAppearance } from './appearance';
import { Action, Copy, pageFrame, row } from './controls';
import { Cover, Row, usePages, useResource } from './CatalogPieces';
import { accessLabel } from '@plyr/next-core/access/label';
import { AUDIO_SPACE_TYPE } from './auth-config';
import { privatePds } from './publishing/private-pds';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { Choice } from './AccountPieces';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';
import { usePortalPages } from './use-portal-pages';
import { ShareLink } from './ShareLink';
import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { useTabs } from './behaviors/use-tabs';
import { SellCard } from './selling/SellCard';
import { createPds } from './pds';
import { toast } from './toast';
import { confirmTrackDelete } from './publishing/confirm-delete';

const portalTabs = ['tracks', 'albums'] as const;
type PortalTab = typeof portalTabs[number];

export function Portal() {
  const auth = useAuth();
  if (!auth.ready) return <PortalPage><WaveLoading label="Loading account" /></PortalPage>;
  if (!auth.did) return <PortalPage>
    <Copy>sign in to manage your uploads.</Copy>
    <View style={row}><Action label="sign in" href={{ pathname: '/login', params: { return_to: '/portal' } }} /></View>
  </PortalPage>;
  return <AccountPortal key={auth.did} did={auth.did} handle={auth.handle} />;
}

function PortalPage({ children, scrollRef, ...props }: {
  children: ReactNode; scrollRef?: Ref<ScrollViewInstance>;
} & Pick<ScrollViewProps, 'onScroll' | 'onContentSizeChange'>) {
  const theme = useAppearance();
  return <ScrollView ref={scrollRef} {...props} scrollEventThrottle={16} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: theme.background }} contentContainerStyle={{ ...pageFrame, gap: 16, paddingTop: 16, paddingBottom: 32 }}>
    {children}
  </ScrollView>;
}

function AccountPortal({ did, handle }: { did: string; handle: string | null }) {
  const [tab, setTab] = useState<PortalTab>('tracks');
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
  useEffect(() => {
    const frame = requestAnimationFrame(restoreScroll);
    return () => cancelAnimationFrame(frame);
  }, [tab, restoreScroll]);
  const selectTab = (next: typeof tab) => {
    if (next === tab) return;
    positions.current[tab] = offset.current;
    visited.current[next] = true;
    restore.current = positions.current[next];
    setTab(next);
  };
  const catalogTabs = useTabs({ label: 'Your catalog', value: tab, onChange: selectTab });
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
  const name = profile?.display_name || handle || 'your uploads';
  const tabs = <View {...catalogTabs.list} style={row}>
      {portalTabs.map(value => <Choice key={value} {...catalogTabs.tab(value)} />)}
    </View>;
  return <PortalPage scrollRef={scroll} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} onContentSizeChange={restoreScroll}>
    <Link href={{ pathname: '/u/[handle]', params: { handle: handle || did } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${name}, view your public profile`}
        style={{ paddingVertical: 8 }}>
        {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.7 : 1 }}>
        <Cover uri={profile?.avatar_url} size={72} round />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 22 * theme.scale, fontWeight: '700' }}>{name}</Text>
          {handle && <Copy>@{handle}</Copy>}
        </View>
        <ChevronRight size={20} color={theme.muted} />
        </View>}
      </Pressable>
    </Link>
    <View style={row}>
      <Action primary label="upload" href="/(main)/(publish)/upload" />
      <Action label="edit profile" href="/edit-profile" />
      <ShareLink path={'/u/' + (handle || did)} />
    </View>
    {artist.error && <View style={row}><Copy>couldn’t load your profile.</Copy><Action label="retry profile" onPress={artist.retry} /></View>}
    <SellCard did={did} />

    <View {...catalogTabs.panel('tracks')} style={{ display: tab === 'tracks' ? 'flex' : 'none' }} aria-hidden={tab !== 'tracks'}><OwnedTracks did={did} active={tab === 'tracks'} tabs={tab === 'tracks' ? tabs : null} /></View>
    {visited.current.albums && <View {...catalogTabs.panel('albums')} style={{ display: tab === 'albums' ? 'flex' : 'none' }} aria-hidden={tab !== 'albums'}><OwnedAlbums did={did} active={tab === 'albums'} tabs={tab === 'albums' ? tabs : null} /></View>}
  </PortalPage>;
}

function CatalogToolbar({ children }: { children: ReactNode }) {
  const theme = useAppearance();
  return <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline, marginBottom: 4 }}>{children}</View>;
}

function OwnedTracks({ did, active, tabs }: { did: string; active: boolean; tabs: ReactNode }) {
  const load = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 25, cursor }), [did]);
  const tracks = usePortalPages(did, 'tracks', load, active);
  const own = useOwnerOnlyTracks(did, active);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const all = [...tracks.data, ...own.data].filter(track => !removed.has(track.record.uri)).sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at));
  const plays = (track: Track) => `${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'play' : 'plays'}`;
  return <View style={{ gap: 8 }}>
    {tabs && <CatalogToolbar>{tabs}</CatalogToolbar>}
    {all.map(track => {
      const subtitle = [accessLabel(track, AUDIO_SPACE_TYPE), !isPrivateTrack(track) && plays(track), track.metadata.album].filter(Boolean).join(' · ');
      return <Row key={track.record.uri} title={track.metadata.title} image={trackArtwork(track)} subtitle={subtitle}
        href={{ pathname: '/track/[id]', params: { id: track.id } }}
        action={isPrivateTrack(track) ? undefined : <View style={{ flexDirection: 'row', marginRight: -6 }}>
          <Edit label={`edit ${track.metadata.title}`} href={{ pathname: '/edit-track/[id]', params: { id: track.id } }} />
          <DeleteTrack track={track} deleted={() => setRemoved(current => new Set(current).add(track.record.uri))} />
        </View>} />;
    })}
    <CatalogState loading={tracks.loading || own.loading} error={tracks.error || own.error} empty={!all.length}
      retry={tracks.error ? tracks.retry : own.more} />
    {(tracks.cursor || own.cursor) && !tracks.loading && !own.loading && !tracks.error && !own.error &&
      <View style={row}><Action label="more tracks" onPress={() => {
        if (tracks.cursor) tracks.more();
        if (own.cursor) own.more();
      }} /></View>}
  </View>;
}

function DeleteTrack({ track, deleted }: { track: Track; deleted: () => void }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const confirm = () => confirmTrackDelete(track.metadata.title, () => {
    setBusy(true);
    createPds(auth).deleteTrack(track.record.uri).then(() => {
      toast.success(`deleted "${track.metadata.title}"`);
      deleted();
    }, failure => {
      setBusy(false);
      toast.error(failure instanceof Error ? failure.message : 'could not delete this track. try again.');
    });
  });
  return <Pressable accessibilityRole="button" accessibilityLabel={`delete ${track.metadata.title}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={confirm}
    style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}>
    <Trash color={theme.muted} size={18} />
  </Pressable>;
}

function Edit({ label, href }: { label: string; href: Href }) {
  const theme = useAppearance();
  return <Link href={href} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Pencil color={theme.muted} size={18} />
    </Pressable>
  </Link>;
}

function useOwnerOnlyTracks(did: string, active: boolean) {
  const auth = useAuth();
  const pds = useMemo(() => auth.did === did && (auth.privatePublishing || auth.privateDeleting) ? privatePds(auth) : undefined,
    [auth.did, auth.rpc, auth.privatePublishing, auth.privateDeleting, did]);
  const load = useCallback(async (cursor?: string): Promise<Page<Track>> => {
    const page = await pds?.list(cursor);
    return { object: 'list', data: page?.tracks ?? [], has_more: !!page?.cursor, next_cursor: page?.cursor };
  }, [pds]);
  const pages = usePages(load);
  useFocusEffect(useCallback(() => { if (active) void pages.revalidate(); }, [active, pages.revalidate]));
  return pages;
}

function OwnedAlbums({ did, active, tabs }: { did: string; active: boolean; tabs: ReactNode }) {
  const load = useCallback((cursor?: string) => api.albums(did, { cursor, limit: 25 }), [did]);
  const albums = usePortalPages<ListSummary>(did, 'collections', load, active);
  return <View style={{ gap: 8 }}>
    {tabs && <CatalogToolbar>{tabs}</CatalogToolbar>}
    {albums.data.map(album => <Row key={album.record.uri} title={album.metadata.name || 'untitled album'} image={collectionArtwork(album)}
      subtitle={`${album.metrics.member_count} ${album.metrics.member_count === 1 ? 'track' : 'tracks'}`}
      href={{ pathname: '/album/[id]', params: { id: album.id } }} />)}
    <CatalogState loading={albums.loading} error={albums.error} empty={!albums.data.length} retry={albums.retry} />
    {albums.cursor && !albums.loading && !albums.error && <View style={row}><Action label="more albums" onPress={albums.more} /></View>}
  </View>;
}

function CatalogState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty: boolean; retry: () => void }) {
  if (loading) return <WaveLoading label="Loading your uploads" />;
  if (error) return <View style={{ gap: 10 }}><Copy>{error}</Copy><View style={row}><Action label="retry" onPress={retry} /></View></View>;
  if (empty) return <View style={{ gap: 12, paddingVertical: 20 }}><Copy>nothing here yet.</Copy></View>;
  return null;
}
