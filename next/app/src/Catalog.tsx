import { useAppearance } from './appearance';
import { ListPlus, DotsThree as Ellipsis } from './icons';
import { collectionArtwork } from '@plyr/next-core/artwork';
import { ownerTrackAddress } from '@plyr/next-core/track-access';
import { useAuth } from './auth';
import { getAuth } from './auth-state';
import { privatePds } from './publishing/private-pds';
import { PrivateTrackDelete } from './publishing/PrivateTrackDelete';
import { canToggleTrack } from '@plyr/next-core/track-revision';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { PauseGlyph as PauseIcon, PlayGlyph as PlayIcon } from './PlayerGlyph';
import { api } from './api-client';
import { type Track } from '@plyr/next-core/api';
import {
  Button, Heading, ListRows, Status, trackCount,
  usePages, useResource, type Play, type TrackActions,
} from './CatalogPieces';
import { Search } from './Search';
import { Home } from './Home';
import { CollectionHero } from './CollectionHero';
import { TrackPresentation } from './TrackPresentation';
import { TrackComments } from './TrackComments';
import { PlayerControl } from './PlayerControl';
import { usePlayback } from './playback';
import { TrackLikes } from './TrackLikes';
import { InlineLink, pageFrame, Copy } from './controls';
import { ArtistProfile } from './ArtistProfile';
import { ShareLink, shareLink } from './ShareLink';
import { TrackMenu } from './TrackMenu';
import { usePlayCount } from './use-play-count';
import { CollectionActions, Library } from './AccountCatalog';
import { useCollectionOrder } from './collections/use-collection-order';
import { offerFor } from '@plyr/next-core/selling';
import { useSeller } from './selling/use-selling';
import { TrackSelling } from './selling/TrackSelling';

const loadPlaylists = (cursor?: string) => api.playlists({ limit: 30, cursor });

function TrackPlayCount({ track }: { track: Track }) {
  const count = usePlayCount(track.id, track.metrics.play_count);
  return <Copy>{count} {count === 1 ? 'play' : 'plays'}</Copy>;
}

function TrackDetail({ id, onPlay, onEnqueue, trackActions }: {
  id: string; onPlay: Play; onEnqueue: (track: Track) => void; trackActions?: TrackActions;
}) {
  const account = useAuth();
  const address = ownerTrackAddress(id);
  const rkey = address?.rkey;
  const owner = address?.owner === account.did ? account.did : null;
  const rpc = owner ? account.rpc : null;
  const pds = useMemo(() => owner && rpc ? privatePds(account) : undefined, [owner, rpc]);
  const load = useCallback(async () => {
    if (!rkey) return await api.track(id);
    return pds ? (await pds.track(rkey)) ?? null : null;
  }, [id, rkey, pds]);
  const result = useResource(load);
  const loadPending = useCallback(async () => pds ? await pds.pending() : [], [pds]);
  const pending = useResource(loadPending);
  const loadCollection = useCallback(async () => pds ? (await pds.list()).tracks : [], [pds]);
  const collection = useResource(loadCollection);
  const navigation = useNavigation();
  const track = result.data;
  const player = usePlayback();
  const [actionsOpen, setActionsOpen] = useState(false);
  if (rkey && (!account.ready || !owner || !rpc || track === null || track && track.artist.did !== owner)) {
    return account.ready ? <Status error="track not found" /> : <Status loading />;
  }
  if (!track) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const active = canToggleTrack(player.current, track, !!player.jam);
  const playing = active && player.status.playing;
  if (pds) {
    const loaded = collection.data ?? [];
    const queue = loaded.some(item => item.record.uri === track.record.uri) ? loaded : [track, ...loaded];
    const waiting = !!pending.data?.some(upload => upload.uri === track.record.uri);
    return <TrackPresentation track={track}
      controls={<PlayerControl primary large glow={playing} icon={playing ? PauseIcon : PlayIcon} label={playing ? 'Pause' : 'Play'}
        busy={active ? player.loading : !collection.data && !collection.error} onPress={() => active ? player.setPlaying(!player.status.playing) : onPlay(track, queue)} />}
      stats={<Copy>only you</Copy>}
      utilities={waiting
        ? <InlineLink href={{ pathname: '/upload', params: { visibility: 'only-you' } }}>finish upload</InlineLink>
        : pending.error ? <Status error={pending.error} retry={pending.retry} />
          : pending.data && <PrivateTrackDelete key={track.record.uri} track={track} auth={account} deletion={pds.deletion} deleted={() => {
            if (getAuth().rpc !== rpc) return;
            player.forgetPrivateTrack(track.record.uri);
            if (navigation.isFocused()) router.replace('/portal');
          }} />} />;
  }
  return <>
    <TrackPresentation track={track}
      controls={<>
        <View style={{ flex: 1, alignItems: 'center' }}><TrackLikes compact track={track} /></View>
        <View style={{ flex: 1, alignItems: 'center' }}><PlayerControl primary large glow={playing} icon={playing ? PauseIcon : PlayIcon}
          label={playing ? 'Pause' : 'Play'}
          busy={active && player.loading}
          onPress={() => active ? player.setPlaying(!player.status.playing) : onPlay(track)} /></View>
        <View style={{ flex: 1, alignItems: 'center' }}><PlayerControl icon={ListPlus} label="Add to queue" onPress={() => onEnqueue(track)} /></View>
      </>}
      stats={<TrackPlayCount track={track} />}
      utilities={<>
        <ShareLink compact path={`/track/${encodeURIComponent(track.id)}`} />
        <PlayerControl icon={Ellipsis} label="More" onPress={() => setActionsOpen(true)} />
      </>}
      access={<TrackSelling track={track} viewer={account.did} />}
      comments={<TrackComments track={track} />} />
    {actionsOpen && <TrackMenu track={track} close={() => setActionsOpen(false)} actions={trackActions?.(track)} />}
  </>;
}

function Collection({ id, album, onPlay }: { id: string; album: boolean; onPlay: Play }) {
  const load = useCallback(() => album ? api.album(id) : api.playlist(id), [id, album]);
  const result = useResource(load, 0, true);
  const { list, saved } = useCollectionOrder(result.data);
  const seller = useSeller(list?.owner.did);
  const player = usePlayback();
  const focus = useRef({ visited: false, retry: result.retry });
  focus.current.retry = result.retry;
  useFocusEffect(useCallback(() => {
    if (focus.current.visited) focus.current.retry();
    focus.current.visited = true;
  }, []));
  if (!list) return <Status loading={!result.error} error={result.error} retry={result.retry} />;
  const tracks = list.members.flatMap((member) => member.track ? [member.track] : []);
  const title = list.metadata.name ?? (album ? 'album' : 'playlist');
  const active = tracks.some(track => canToggleTrack(player.current, track, !!player.jam));
  const missing = list.metrics.member_count - tracks.length;
  return <>
    <CollectionHero list={list} tracks={tracks} title={title} playing={active && player.status.playing}
      offer={offerFor(seller, [list.record.uri])}
      onPlay={(track, queue) => active && queue === tracks ? player.setPlaying(true) : onPlay(track, queue, title)}
      onPause={() => player.setPlaying(false)}
      onEnqueue={() => player.enqueueAll(tracks, title)}
      onShare={() => void shareLink(`/${album ? 'album' : 'playlist'}/${encodeURIComponent(id)}`)} />
    {missing > 0 && <Copy>{!tracks.length
      ? `${missing === 1 ? 'the track in this ' : 'the tracks in this '}${album ? 'album' : 'playlist'} ${missing === 1 ? 'was' : 'were'} deleted or can't be loaded right now.`
      : `${missing} no longer available.`}</Copy>}
    <CollectionActions list={list} refresh={result.retry} onPlay={onPlay} onOrderSaved={saved} />
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
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode={screen === 'search' ? 'on-drag' : undefined} automaticallyAdjustKeyboardInsets={screen === 'search'}>
    <View style={styles.page}>{content}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...pageFrame, paddingTop: 16, paddingBottom: 32, gap: 16 },
});
