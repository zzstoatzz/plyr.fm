import { useAppearance } from './appearance';
import { ListPlus, DotsThree as Ellipsis } from './icons';
import { collectionArtwork } from './artwork';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { PauseGlyph as PauseIcon, PlayGlyph as PlayIcon } from './PlayerGlyph';
import { api, type Track } from './api';
import {
  Button, Heading, ListRows, Status, trackCount,
  usePages, useResource, type Play, type TrackActions,
} from './CatalogPieces';
import { Search } from './Search';
import { Home } from './Home';
import { DetailHeader } from './DetailHeader';
import { TrackPresentation } from './TrackPresentation';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { TrackLikes } from './TrackLikes';
import { InlineLink, pageFrame, Copy } from './controls';
import { ArtistProfile } from './ArtistProfile';
import { ShareLink } from './ShareLink';
import { TrackMenu } from './TrackMenu';
import { usePlayCount } from './use-play-count';
import { CollectionActions, Library } from './AccountCatalog';
import { useCollectionOrder } from './collections/use-collection-order';

const loadPlaylists = (cursor?: string) => api.playlists({ limit: 30, cursor });

function TrackPlayCount({ track }: { track: Track }) {
  const count = usePlayCount(track.id, track.metrics.play_count);
  return <Copy>{count} {count === 1 ? 'play' : 'plays'}</Copy>;
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
  const { list, saved } = useCollectionOrder(result.data);
  const focus = useRef({ visited: false, retry: result.retry });
  focus.current.retry = result.retry;
  useFocusEffect(useCallback(() => {
    if (focus.current.visited) focus.current.retry();
    focus.current.visited = true;
  }, []));
  if (!list) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const tracks = list.members.flatMap((member) => member.track ? [member.track] : []);
  return <>
    <DetailHeader title={list.metadata.name ?? (album ? 'album' : 'playlist')} artwork={collectionArtwork(list)}>
    {list.owner.profile && <InlineLink href={{ pathname: '/u/[handle]', params: { handle: list.owner.profile.handle || list.owner.did } }}>
      {list.owner.profile.display_name || list.owner.profile.handle}
    </InlineLink>}
    <Copy>{tracks.length ? trackCount(tracks.length) : 'no playable tracks'}{tracks.length && tracks.length < list.metrics.member_count ? ` · ${list.metrics.member_count - tracks.length} no longer available` : ''}</Copy>
    </DetailHeader>
    {!tracks.length && list.metrics.member_count > 0 && <Copy>
      {list.metrics.member_count === 1 ? 'the track in this ' : 'the tracks in this '}{album ? 'album' : 'playlist'} {list.metrics.member_count === 1 ? 'was' : 'were'} deleted or can't be loaded right now.
    </Copy>}
    <CollectionActions list={list} refresh={result.retry} onPlay={onPlay} onOrderSaved={saved} actions={<>
      {tracks[0] && <PlayerControl primary large icon={PlayIcon} label={album ? 'Play album' : 'Play playlist'} onPress={() => onPlay(tracks[0], tracks, list.metadata.name ?? (album ? 'album' : 'playlist'))} />}
      <ShareLink compact path={`/${album ? 'album' : 'playlist'}/${encodeURIComponent(id)}`} />
    </>} />
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
  const colors = useAppearance();
  const { id, handle } = useLocalSearchParams<{ id?: string; handle?: string }>();
  let content: ReactNode;
  if (screen === 'home') return <Home onPlay={onPlay} />;
  else if (screen === 'search') content = <Search onPlay={onPlay} />;
  else if (screen === 'playlists') content = <Playlists />;
  else if (screen === 'library' || screen === 'liked') content = <Library likesOnly={screen === 'liked'} onPlay={onPlay} />;
  else if (screen === 'track' && id) content = <TrackDetail key={id} id={id} onPlay={onPlay} onEnqueue={onEnqueue} trackActions={trackActions} />;
  else if ((screen === 'album' || screen === 'playlist') && id) {
    content = <Collection key={id} id={id} album={screen === 'album'} onPlay={onPlay} />;
  } else if (screen === 'artist' && handle) content = <ArtistProfile key={handle} handle={handle} onPlay={onPlay} />;
  else content = <Copy>this catalog link is incomplete.</Copy>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} keyboardShouldPersistTaps="handled" keyboardDismissMode={screen === 'search' ? 'on-drag' : undefined} automaticallyAdjustKeyboardInsets={screen === 'search'}>
    <View style={styles.page}>{content}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...pageFrame, paddingTop: 16, paddingBottom: 32, gap: 16 },
});
