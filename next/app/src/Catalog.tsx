import { Link, type Href, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import SearchIcon from 'lucide-react-native/icons/search';
import X from 'lucide-react-native/icons/x';
import { api, type SearchHit, type Track } from './api';
import {
  Button, Detail, Heading, ListRows, Row, RowPlay, Status, TrackRows, artistName, errorMessage, useColors,
  usePages, useResource, type Play, type TrackActions,
} from './CatalogPieces';
import { WaveLoading } from './WaveLoading';
import { DetailHeader } from './DetailHeader';
import { Sheet } from './Sheet';
import { usePlayback } from './playback';
import { TrackLikes } from './TrackLikes';
import { useAuth } from './auth';
import { Action, pageFrame } from './controls';
import { SITE_URL } from './config';
import { CollectionActions, Library, SignedTrackActions } from './AccountCatalog';

const loadLatest = (cursor?: string) => api.tracks({ limit: 30, cursor });
const loadPlaylists = (cursor?: string) => api.playlists({ limit: 30, cursor });
const loadChart = () => api.chart('week');

function Home({ onPlay }: { onPlay: Play }) {
  const latest = usePages(loadLatest);
  const chart = useResource(loadChart);
  const chartTracks = chart.data?.data.slice(0, 5).map(({ track }) => track) ?? [];
  return <>
    {chartTracks.length > 0 && <View style={styles.group}>
      <Heading>Top this week</Heading>
      <TrackRows tracks={chartTracks} onPlay={onPlay} />
    </View>}
    <View style={styles.group}>
      <Heading>Latest</Heading>
      <TrackRows tracks={latest.data} onPlay={onPlay} />
      {latest.loading ? <WaveLoading label="Loading tracks" /> :
        <Status error={latest.error} retry={latest.more} empty={!latest.data.length ? 'No tracks yet.' : undefined} />}
      {latest.cursor && !latest.loading && !latest.error && <Button label="More tracks" onPress={latest.more} />}
    </View>
  </>;
}

function Search({ onPlay }: { onPlay: Play }) {
  const colors = useColors();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [playingHit, setPlayingHit] = useState<string>();
  const [playError, setPlayError] = useState<string>();
  const request = useRef(0);
  useFocusEffect(useCallback(() => {
    setPlayingHit(undefined);
    return () => { request.current += 1; };
  }, []));
  function changeQuery(value: string) {
    request.current += 1;
    setQuery(value);
    setPlayingHit(undefined);
    setPlayError(undefined);
  }
  async function playResult(id: string) {
    const attempt = ++request.current;
    setPlayingHit(id);
    setPlayError(undefined);
    try {
      const track = await api.track(id);
      if (request.current === attempt) onPlay(track);
    } catch (error) {
      if (request.current === attempt) setPlayError(errorMessage(error));
    } finally {
      if (request.current === attempt) setPlayingHit(undefined);
    }
  }
  const term = query.trim();
  const load = useCallback(() => term.length >= 2 ? api.search(term).then((page) => page.data) : Promise.resolve([]), [term]);
  const search = useResource(load, 250);
  function href(hit: SearchHit): Href {
    if (hit.type === 'artist') return { pathname: '/u/[handle]', params: { handle: hit.owner.handle || hit.owner.did } };
    if (hit.type === 'track') return { pathname: '/track/[id]', params: { id: hit.id } };
    if (hit.type === 'album') return { pathname: '/album/[id]', params: { id: hit.id } };
    return { pathname: '/playlist/[id]', params: { id: hit.id } };
  }
  const groups = [
    ['track', 'Tracks'], ['artist', 'Artists'], ['album', 'Albums'], ['playlist', 'Playlists'],
  ] as const;
  return <>
    <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: focused ? colors.muted : 'transparent' }]}>
      <SearchIcon size={19} color={colors.muted} />
      <TextInput
        ref={input}
        accessibilityLabel="Search tracks, artists, albums and playlists"
        placeholder="Tracks, artists and more"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={changeQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.searchInput, { color: colors.text, fontFamily: colors.fontFamily, fontSize: 16 * colors.scale }]}
      />
      {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clearSearch}
        onPress={() => { changeQuery(''); input.current?.focus(); }}>
        <X size={18} color={colors.muted} />
      </Pressable>}
    </View>
    {playError && <Detail>{playError}</Detail>}
    {term.length < 2 ? <Detail>Enter at least two characters.</Detail> : <>
      <Status loading={!search.data && !search.error} error={search.error} retry={search.retry} empty={search.data?.length === 0 ? 'No results.' : undefined} />
      {groups.map(([type, title]) => {
        const hits = search.data?.filter((hit) => hit.type === type) ?? [];
        return hits.length > 0 ? <View style={styles.group} key={type}>
          <Heading>{title}</Heading>
          {hits.map((hit) => <Row
            key={hit.id} href={href(hit)} title={hit.title} image={hit.image_url}
            subtitle={type === 'artist' ? hit.owner.handle : hit.owner.display_name || hit.owner.handle}
            round={type === 'artist'}
            action={type === 'track' ? <RowPlay label={`Play ${hit.title}`} busy={playingHit === hit.id} onPress={() => void playResult(hit.id)} /> : undefined}
          />)}
        </View> : null;
      })}
    </>}
  </>;
}

function ShareLink({ path }: { path: string }) {
  const [message, setMessage] = useState<string>();
  async function share() {
    try {
      const url = SITE_URL + path;
      if (Platform.OS === 'web' && typeof navigator.share !== 'function') {
        await navigator.clipboard.writeText(url);
        setMessage('Link copied.');
      } else if (Platform.OS === 'web') {
        await navigator.share({ url });
      } else {
        await Share.share({ message: url });
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage('Could not share this link.');
    }
  }
  return <View style={styles.group}>
    <Button label="Share" onPress={() => void share()} />
    {message && <Detail>{message}</Detail>}
  </View>;
}

function TrackDetail({ id, onPlay, onEnqueue, trackActions }: {
  id: string; onPlay: Play; onEnqueue: (track: Track) => void; trackActions?: TrackActions;
}) {
  const load = useCallback(() => api.track(id), [id]);
  const result = useResource(load);
  const track = result.data;
  const auth = useAuth();
  const player = usePlayback();
  const [actionsOpen, setActionsOpen] = useState(false);
  if (!track) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  return <>
    <DetailHeader title={track.metadata.title} artwork={track.media.artwork?.url}>
    <Link href={{ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } }}>
      <Detail>{artistName(track)}</Detail>
    </Link>
    {track.metadata.album && <Detail>{track.metadata.album}</Detail>}
    <View style={styles.actions}><Detail>{track.metrics.play_count} plays</Detail><TrackLikes track={track} /></View>
    </DetailHeader>
    <View style={styles.actions}>
      <Action primary disabled={player.current?.id === track.id && player.loading}
        label={player.current?.id === track.id ? (player.loading ? 'Loading…' : player.status.playing ? 'Pause' : 'Play') : 'Play'}
        onPress={() => player.current?.id === track.id ? player.toggle() : onPlay(track)} />
      <Action label="Add to queue" onPress={() => onEnqueue(track)} />
      <Action label="More" onPress={() => setActionsOpen(true)} />
    </View>
    {actionsOpen && <Sheet title="Track actions" close={() => setActionsOpen(false)}>
      <View style={styles.actions}>
        {auth.did === track.artist.did && <Action label="Edit track" href={`/edit-track/${track.id}`} onPress={() => setActionsOpen(false)} />}
        <ShareLink path={`/track/${encodeURIComponent(track.id)}`} />
        {trackActions ? trackActions(track) : <SignedTrackActions track={track} />}
      </View>
    </Sheet>}
    {track.metadata.description && <Detail>{track.metadata.description}</Detail>}
  </>;
}

function Collection({ id, album, onPlay }: { id: string; album: boolean; onPlay: Play }) {
  const load = useCallback(() => album ? api.album(id) : api.playlist(id), [id, album]);
  const result = useResource(load);
  const list = result.data;
  if (!list) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const tracks = list.members.flatMap((member) => member.track ? [member.track] : []);
  return <>
    <DetailHeader title={list.metadata.name ?? (album ? 'Album' : 'Playlist')} artwork={list.media?.artwork?.url}>
    {list.owner.profile && <Link href={{ pathname: '/u/[handle]', params: { handle: list.owner.profile.handle || list.owner.did } }}>
      <Detail>{list.owner.profile.display_name || list.owner.profile.handle}</Detail>
    </Link>}
    <Detail>{tracks.length} of {list.metrics.member_count} tracks available</Detail>
    </DetailHeader>
    <View style={styles.actions}>
      {tracks[0] && <Action primary label={album ? 'Play album' : 'Play playlist'} onPress={() => onPlay(tracks[0], tracks)} />}
      <ShareLink path={`/${album ? 'album' : 'playlist'}/${encodeURIComponent(id)}`} />
      <CollectionActions list={list} refresh={result.retry} />
    </View>
    <Heading>Tracks</Heading>
    <TrackRows tracks={tracks} onPlay={onPlay} />
  </>;
}

function ArtistPage({ handle, onPlay }: { handle: string; onPlay: Play }) {
  const load = useCallback(() => api.artist(handle), [handle]);
  const result = useResource(load);
  if (!result.data) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const artist = result.data;
  const support = /^https?:\/\//i.test(artist.support_url ?? '') ? artist.support_url : null;
  return <>
    <DetailHeader title={artist.display_name || artist.handle} artwork={artist.avatar_url} round>
    <Detail>@{artist.handle}</Detail>
    {artist.bio && <Detail>{artist.bio}</Detail>}
    {support && <Link href={support as Href}><Detail>Support artist</Detail></Link>}
    </DetailHeader>
    <View style={styles.actions}>
      <ShareLink path={`/u/${encodeURIComponent(artist.handle || artist.did)}`} />
      <ArtistEdit did={artist.did} />
    </View>
    <ArtistCatalog did={artist.did} onPlay={onPlay} />
  </>;
}

function ArtistEdit({ did }: { did: string }) {
  const auth = useAuth();
  return auth.did === did ? <Action label="Edit profile" href="/edit-profile" /> : null;
}

function ArtistCatalog({ did, onPlay }: { did: string; onPlay: Play }) {
  const loadTracks = useCallback((cursor?: string) => api.tracks({ artist_did: did, limit: 50, cursor }), [did]);
  const loadLists = useCallback(() => Promise.all([api.albums(did), api.playlists({ owner_did: did })]), [did]);
  const loadMetrics = useCallback(() => api.artistMetrics(did), [did]);
  const loadLikes = useCallback(() => api.actorLikes(did, { limit: 50 }), [did]);
  const tracks = usePages(loadTracks);
  const lists = useResource(loadLists);
  const metrics = useResource(loadMetrics);
  const likes = useResource(loadLikes);
  return <>
    {metrics.data && <Detail>{metrics.data.totals.tracks} tracks · {metrics.data.totals.plays} plays</Detail>}
    <Heading>Tracks</Heading>
    {tracks.data[0] && <Button label="Play tracks" onPress={() => onPlay(tracks.data[0], tracks.data)} />}
    <TrackRows tracks={tracks.data} onPlay={onPlay} />
    <Status loading={tracks.loading} error={tracks.error} retry={tracks.more} empty={!tracks.data.length ? 'No tracks yet.' : undefined} />
    {tracks.cursor && !tracks.loading && !tracks.error && <Button label="More tracks" onPress={tracks.more} />}
    {lists.data?.map((list, index) => list.data.length > 0 && <View style={styles.group} key={index}>
      <Heading>{index === 0 ? 'Albums' : 'Playlists'}</Heading>
      <ListRows lists={list.data} />
    </View>)}
    {likes.data && likes.data.data.length > 0 && <View style={styles.group}>
      <Heading>Likes</Heading>
      <TrackRows tracks={likes.data.data} onPlay={onPlay} />
    </View>}
  </>;
}

function Playlists() {
  const lists = usePages(loadPlaylists);
  return <>
    <Heading main>Playlists</Heading>
    <ListRows lists={lists.data} />
    <Status loading={lists.loading} error={lists.error} retry={lists.more} empty={!lists.data.length ? 'No playlists yet.' : undefined} />
    {lists.cursor && !lists.loading && !lists.error && <Button label="More playlists" onPress={lists.more} />}
  </>;
}

export type CatalogScreen = 'home' | 'search' | 'playlists' | 'track' | 'album' | 'playlist' | 'artist' | 'library' | 'liked';

export function Catalog({
  screen, onPlay, onEnqueue, trackActions,
}: { screen: CatalogScreen; onPlay: Play; onEnqueue: (track: Track) => void; trackActions?: TrackActions }) {
  const colors = useColors();
  const { id, handle } = useLocalSearchParams<{ id?: string; handle?: string }>();
  let content: ReactNode;
  if (screen === 'home') content = <Home onPlay={onPlay} />;
  else if (screen === 'search') content = <Search onPlay={onPlay} />;
  else if (screen === 'playlists') content = <Playlists />;
  else if (screen === 'library' || screen === 'liked') content = <Library likesOnly={screen === 'liked'} onPlay={onPlay} />;
  else if (screen === 'track' && id) content = <TrackDetail key={id} id={id} onPlay={onPlay} onEnqueue={onEnqueue} trackActions={trackActions} />;
  else if ((screen === 'album' || screen === 'playlist') && id) {
    content = <Collection key={id} id={id} album={screen === 'album'} onPlay={onPlay} />;
  } else if (screen === 'artist' && handle) content = <ArtistPage key={handle} handle={handle} onPlay={onPlay} />;
  else content = <Detail>This catalog link is incomplete.</Detail>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
    <View style={styles.page}>{content}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...pageFrame, paddingTop: 16, paddingBottom: 32, gap: 16 },
  group: { gap: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  searchField: { minHeight: 46, borderRadius: 24, borderWidth: 1, paddingLeft: 13, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, paddingRight: 4, ...Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 0 } }) },
  clearSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
