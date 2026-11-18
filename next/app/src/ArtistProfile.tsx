import { TrackRows } from './TrackRows';
import { useAppearance } from './appearance';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { api } from './api-client';
import { type Artist } from '@plyr/next-core/api';
import { useAuth } from './auth';
import { Action, Copy } from './controls';
import { ListRows, Status, usePages, useResource, type Play } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { shareLink } from './ShareLink';
import { ArtistHero } from './ArtistHero';
import { useTabs } from './behaviors/use-tabs';

const sections = ['tracks', 'albums', 'playlists', 'likes'] as const;
type Section = typeof sections[number];

export function ArtistProfile({ handle, onPlay }: { handle: string; onPlay: Play }) {
  const load = useCallback(() => api.artist(handle), [handle]);
  const result = useResource(load);
  if (!result.data) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  return <ArtistCatalog key={result.data.did} artist={result.data} onPlay={onPlay} />;
}

function useArtistCatalog(did: string) {
  const loadTracks = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 50, cursor }), [did]);
  const loadAlbums = useCallback((cursor?: string) => api.albums(did, { limit: 30, cursor }), [did]);
  const loadPlaylists = useCallback((cursor?: string) => api.playlists({ owner_did: did, limit: 30, cursor }), [did]);
  const loadLikes = useCallback((cursor?: string) => api.actorLikes(did, { limit: 50, cursor }), [did]);
  const loadMetrics = useCallback(() => api.artistMetrics(did), [did]);
  return {
    tracks: usePages(loadTracks), albums: usePages(loadAlbums),
    playlists: usePages(loadPlaylists), likes: usePages(loadLikes), metrics: useResource(loadMetrics),
  };
}

function ArtistCatalog({ artist, onPlay }: { artist: Artist; onPlay: Play }) {
  const { tracks, albums, playlists, likes, metrics } = useArtistCatalog(artist.did);
  const [section, setSection] = useState<Section>('tracks');
  const visited = useRef(false);
  const revalidateAlbums = albums.revalidate;
  useFocusEffect(useCallback(() => {
    if (visited.current) void revalidateAlbums();
    visited.current = true;
  }, [revalidateAlbums]));
  const catalogTabs = useTabs({ label: 'Artist catalog', value: section, onChange: setSection });
  const theme = useAppearance();
  const auth = useAuth();
  const name = artist.display_name || artist.handle;
  return <>
    <ArtistHero artist={artist} tracks={tracks.data} metrics={metrics.data ?? null} owner={auth.did === artist.did}
      onPlay={(track, queue) => onPlay(track, queue, name)}
      onShare={() => void shareLink(`/u/${encodeURIComponent(artist.handle || artist.did)}`)}
      footer={metrics.error ? <View style={[styles.actions, { marginTop: 12 }]}><Copy>couldn’t load totals.</Copy><Action label="Retry totals" onPress={metrics.retry} /></View> : null} />
    <View style={[styles.tabsRule, { borderColor: theme.hairline }]}><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      <View {...catalogTabs.list} style={styles.tabs}>
        {sections.map(value => <Choice key={value} {...catalogTabs.tab(value)} />)}
      </View>
    </ScrollView></View>
    <View {...catalogTabs.panel(section)} style={styles.panel}>
      {section === 'tracks' && <>
        <TrackRows tracks={tracks.data} onPlay={(track, queue) => onPlay(track, queue, name)} />
        <PageStatus page={tracks} label="tracks" />
      </>}
      {section === 'albums' && <>{auth.did === artist.did && <Action primary label="New album" href="/create-album" />}<ListRows lists={albums.data} includeEmpty={auth.did === artist.did} /><PageStatus page={albums} label="albums" /></>}
      {section === 'playlists' && <><ListRows lists={playlists.data} includeEmpty={auth.did === artist.did} /><PageStatus page={playlists} label="playlists" /></>}
      {section === 'likes' && <>
        <TrackRows tracks={likes.data} onPlay={(track, queue) => onPlay(track, queue, `liked by ${name}`)} />
        <PageStatus page={likes} label="likes" />
      </>}
    </View>
  </>;
}

function PageStatus<T>({ page, label }: { page: ReturnType<typeof usePages<T>>; label: string }) {
  return <>
    <Status loading={page.loading} error={page.error} retry={page.more} empty={!page.data.length ? `no ${label} yet.` : undefined} />
    {page.cursor && !page.loading && !page.error && <View style={styles.actions}><Action label={`More ${label}`} onPress={page.more} /></View>}
  </>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  tabsRule: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: 6 },
  panel: { gap: 12 },
});
