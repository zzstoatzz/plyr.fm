import { useAppearance } from './appearance';
import { useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { api, type Artist } from './api';
import { useAuth } from './auth';
import { Action, InlineLink, Copy } from './controls';
import { ListRows, Status, TrackRows, usePages, useResource, type Play } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { DetailHeader } from './DetailHeader';
import { PlayerControl } from './PlayerControl';
import { PlayGlyph } from './PlayerGlyph';
import { ShareLink } from './ShareLink';
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
  const catalogTabs = useTabs({ label: 'Artist catalog', values: sections, value: section, onChange: setSection });
  const theme = useAppearance();
  const auth = useAuth();
  const name = artist.display_name || artist.handle;
  const support = /^https?:\/\//i.test(artist.support_url ?? '') ? artist.support_url : null;
  return <>
    <DetailHeader title={name} artwork={artist.avatar_url} round actions={<>
      {tracks.data[0] && <PlayerControl primary large icon={PlayGlyph} label="Play tracks"
        onPress={() => onPlay(tracks.data[0], tracks.data, name)} />}
      <ShareLink compact path={`/u/${encodeURIComponent(artist.handle || artist.did)}`} />
      {auth.did === artist.did && <Action label="Edit profile" href="/edit-profile" />}
    </>}>
      <Copy>@{artist.handle}</Copy>
      {metrics.data && <Copy>{metrics.data.totals.tracks} {metrics.data.totals.tracks === 1 ? 'track' : 'tracks'} · {metrics.data.totals.plays} {metrics.data.totals.plays === 1 ? 'play' : 'plays'}</Copy>}
    </DetailHeader>
    {artist.bio && <Copy>{artist.bio}</Copy>}
    {support && <InlineLink standalone href={support as Href}>support artist</InlineLink>}
    {metrics.error && <View style={styles.actions}><Copy>couldn’t load totals.</Copy><Action label="Retry totals" onPress={metrics.retry} /></View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      <View {...catalogTabs.list} style={[styles.tabs, { borderColor: theme.hairline }]}>
        {sections.map(value => <Choice key={value} {...catalogTabs.tab(value)} />)}
      </View>
    </ScrollView>
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
  tabs: { flexDirection: 'row', gap: 6, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  panel: { gap: 12 },
});
