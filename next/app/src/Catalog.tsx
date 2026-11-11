import { collectionArtwork } from './artwork';
import { type Href, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PauseGlyph as PauseIcon, PlayGlyph as PlayIcon } from './PlayerGlyph';
import ListPlus from 'lucide-react-native/icons/list-plus';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import { api, type Track } from './api';
import {
  Button, Detail, Heading, ListRows, Status, TrackRows, artistName, useColors,
  usePages, useResource, type Play, type TrackActions,
} from './CatalogPieces';
import { WaveLoading } from './WaveLoading';
import { Search } from './Search';
import { Home } from './Home';
import { DetailHeader } from './DetailHeader';
import { TrackPresentation } from './TrackPresentation';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { TrackLikes } from './TrackLikes';
import { useAuth } from './auth';
import { Action, InlineLink, pageFrame } from './controls';
import { ShareLink } from './ShareLink';
import { TrackMenu } from './TrackMenu';
import { usePlayCount } from './use-play-count';
import { CollectionActions, Library } from './AccountCatalog';

const loadPlaylists = (cursor?: string) => api.playlists({ limit: 30, cursor });

function TrackPlayCount({ track }: { track: Track }) {
  const count = usePlayCount(track.id, track.metrics.play_count);
  return <Detail>{count} {count === 1 ? 'play' : 'plays'}</Detail>;
}

function TrackDetail({ id, onPlay, onEnqueue, trackActions }: {
  id: string; onPlay: Play; onEnqueue: (track: Track) => void; trackActions?: TrackActions;
}) {
  const load = useCallback(() => api.track(id), [id]);
  const result = useResource(load);
  const track = result.data;
  const player = usePlayback();
  const [actionsOpen, setActionsOpen] = useState(false);
  if (!track) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  return <>
    <TrackPresentation track={track}
      controls={<>
        <View style={{ flex: 1, alignItems: 'center' }}><TrackLikes compact track={track} /></View>
        <View style={{ flex: 1, alignItems: 'center' }}><PlayerControl primary large glow={player.current?.id === track.id && player.status.playing} icon={player.current?.id === track.id && player.status.playing ? PauseIcon : PlayIcon}
          label={player.current?.id === track.id && player.status.playing ? 'Pause' : 'Play'}
          busy={player.current?.id === track.id && player.loading}
          onPress={() => player.current?.id === track.id ? player.setPlaying(!player.status.playing) : onPlay(track)} /></View>
        <View style={{ flex: 1, alignItems: 'center' }}><PlayerControl icon={ListPlus} label="Add to queue" onPress={() => onEnqueue(track)} /></View>
      </>}
      stats={<TrackPlayCount track={track} />}
      utilities={<>
        <ShareLink compact path={`/track/${encodeURIComponent(track.id)}`} />
        <PlayerControl icon={Ellipsis} label="More" onPress={() => setActionsOpen(true)} />
      </>} />
    {actionsOpen && <TrackMenu track={track} close={() => setActionsOpen(false)} actions={trackActions?.(track)} />}
  </>;
}

function Collection({ id, album, onPlay }: { id: string; album: boolean; onPlay: Play }) {
  const load = useCallback(() => album ? api.album(id) : api.playlist(id), [id, album]);
  const result = useResource(load, 0, true);
  const list = result.data;
  if (!list) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const tracks = list.members.flatMap((member) => member.track ? [member.track] : []);
  return <>
    <DetailHeader kind={album ? 'album' : 'playlist'} title={list.metadata.name ?? (album ? 'album' : 'playlist')} artwork={collectionArtwork(list)}>
    {list.owner.profile && <InlineLink href={{ pathname: '/u/[handle]', params: { handle: list.owner.profile.handle || list.owner.did } }}>
      {list.owner.profile.display_name || list.owner.profile.handle}
    </InlineLink>}
    <Detail>{tracks.length} of {list.metrics.member_count} tracks available</Detail>
    </DetailHeader>
    <CollectionActions list={list} refresh={result.retry} onPlay={onPlay} actions={<>
      {tracks[0] && <Action primary icon={PlayIcon} label={album ? 'Play album' : 'Play playlist'} onPress={() => onPlay(tracks[0], tracks, list.metadata.name ?? (album ? 'album' : 'playlist'))} />}
      <ShareLink path={`/${album ? 'album' : 'playlist'}/${encodeURIComponent(id)}`} />
    </>} />
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
    {support && <InlineLink standalone href={support as Href}>support artist</InlineLink>}
    </DetailHeader>
    <View style={styles.actions}>
      <ShareLink compact path={`/u/${encodeURIComponent(artist.handle || artist.did)}`} />
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
    <Heading>tracks</Heading>
    {tracks.data[0] && <Button primary icon={PlayIcon} label="Play tracks" onPress={() => onPlay(tracks.data[0], tracks.data)} />}
    <TrackRows tracks={tracks.data} onPlay={onPlay} />
    <Status loading={tracks.loading} error={tracks.error} retry={tracks.more} empty={!tracks.data.length ? 'no tracks yet.' : undefined} />
    {tracks.cursor && !tracks.loading && !tracks.error && <Button label="More tracks" onPress={tracks.more} />}
    {lists.data?.map((list, index) => list.data.length > 0 && <View style={styles.group} key={index}>
      <Heading>{index === 0 ? 'Albums' : 'Playlists'}</Heading>
      <ListRows lists={list.data} />
    </View>)}
    {likes.data && likes.data.data.length > 0 && <View style={styles.group}>
      <Heading>likes</Heading>
      <TrackRows tracks={likes.data.data} onPlay={onPlay} />
    </View>}
  </>;
}

function Playlists() {
  const lists = usePages(loadPlaylists);
  return <>
    <Heading main>playlists</Heading>
    <ListRows lists={lists.data} />
    <Status loading={lists.loading} error={lists.error} retry={lists.more} empty={!lists.data.length ? 'no playlists yet.' : undefined} />
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
  if (screen === 'home') return <Home onPlay={onPlay} />;
  else if (screen === 'search') content = <Search onPlay={onPlay} />;
  else if (screen === 'playlists') content = <Playlists />;
  else if (screen === 'library' || screen === 'liked') content = <Library likesOnly={screen === 'liked'} onPlay={onPlay} />;
  else if (screen === 'track' && id) content = <TrackDetail key={id} id={id} onPlay={onPlay} onEnqueue={onEnqueue} trackActions={trackActions} />;
  else if ((screen === 'album' || screen === 'playlist') && id) {
    content = <Collection key={id} id={id} album={screen === 'album'} onPlay={onPlay} />;
  } else if (screen === 'artist' && handle) content = <ArtistPage key={handle} handle={handle} onPlay={onPlay} />;
  else content = <Detail>this catalog link is incomplete.</Detail>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled" keyboardDismissMode={screen === 'search' ? 'on-drag' : undefined} automaticallyAdjustKeyboardInsets={screen === 'search'}>
    <View style={styles.page}>{content}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...pageFrame, paddingTop: 16, paddingBottom: 32, gap: 16 },
  group: { gap: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});
