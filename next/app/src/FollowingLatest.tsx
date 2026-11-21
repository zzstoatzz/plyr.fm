import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from './api-client';
import { type Track } from '@plyr/next-core/api';
import { useAppearance } from './appearance';
import { trackArtwork } from '@plyr/next-core/artwork';
import { PlayingArtworkOverlay } from './PlayingWave';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTrackPress } from './TrackPress';
import { useTrackPlayback, useTrackPlaybackState } from './playback-context';
import { canToggleTrack } from '@plyr/next-core/track-revision';
import { shuffled } from '@plyr/next-core/queue-state';
import { Cover, type Play } from './CatalogPieces';
import type { NetworkArtist } from './home-api';
import { formatDuration, timeAgo } from './home-state';
import { Shuffle } from './icons';
import { cardSurface } from './materials';
import { Text } from './Text';

const MOST = 12;
const newest = new Map<string, Promise<Track | undefined>>();

function latestBy(did: string) {
  let load = newest.get(did);
  if (!load) {
    load = api.tracks({ artist_did: did, limit: 1 }).then(page => page.data[0], () => { newest.delete(did); return undefined; });
    newest.set(did, load);
  }
  return load;
}

/** The newest track from each artist you follow, newest first. Artists whose track can't be loaded are left out. */
export function useFollowingLatest(artists: NetworkArtist[]) {
  const [tracks, setTracks] = useState<{ key: string; data: Track[] }>({ key: '', data: [] });
  const key = artists.slice(0, MOST).map(artist => artist.did).join(',');
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(',').map(latestBy)).then(found => {
      if (!live) return;
      const data = found.filter((track): track is Track => !!track)
        .sort((a, b) => Date.parse(b.metadata.created_at) - Date.parse(a.metadata.created_at));
      setTracks({ key, data });
    });
    return () => { live = false; };
  }, [key]);
  return { tracks: tracks.key === key ? tracks.data : [], loading: !!key && tracks.key !== key };
}

const name = (track: Track) => track.artist.profile.display_name || track.artist.profile.handle;
export const followingLabel = 'new from people you know';

/** Plays every person's newest track in a row; an icon on phones so the heading never wraps. */
export function PlayOneFromEach({ tracks, onPlay, compact }: { tracks: Track[]; onPlay: Play; compact: boolean }) {
  const theme = useAppearance();
  const player = useTrackPlaybackState();
  if (tracks.length < 2) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="play one from each"
    onPress={() => { const order = shuffled(tracks, track => canToggleTrack(player.current, track, player.inJam)); onPlay(order[0], order, followingLabel); }} style={styles.each}>
    {({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => compact
      ? <View style={[styles.round, { backgroundColor: pressed ? theme.hover : theme.raised }]}><Shuffle size={16} color={theme.text} /></View>
      : <>
        <Shuffle size={16} color={hovered ? theme.text : theme.muted} />
        <Text style={{ color: hovered ? theme.text : theme.muted, fontSize: 13.5 * theme.scale, fontWeight: '600' }}>play one from each</Text>
      </>}
  </Pressable>;
}

/** One person's newest track, drawn like a top tracks card: the whole card plays, the title and name link. */
export function FollowingTrack({ track, tracks, onPlay, now, width }: { track: Track; tracks: Track[]; onPlay: Play; now: number; width: number }) {
  const theme = useAppearance();
  const { current, playing, toggle } = useTrackPlayback(track);
  const { row, hold, menu } = useTrackPress(track);
  const who = name(track);
  const lines = [14, 12].map(size => Math.ceil(size * theme.scale * 1.3));
  const when = timeAgo(track.metadata.created_at, now);
  return <GestureDetector gesture={hold}><View ref={row} testID="following-track" style={[cardSurface(theme), styles.card, { width }]}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.metadata.title} by ${who}`}
      onPress={() => toggle(() => onPlay(track, tracks, followingLabel))}
      style={({ pressed }) => [StyleSheet.absoluteFill, { borderRadius: 8, backgroundColor: pressed ? theme.hover : 'transparent' }]} />
    <View pointerEvents="none" style={styles.art}>
      <Cover uri={trackArtwork(track) || track.artist.profile.avatar_url} size={48} radius={6} />
      {playing && <PlayingArtworkOverlay />}
    </View>
    <View pointerEvents="box-none" style={styles.text}>
      <Link href={{ pathname: '/track/[id]', params: { id: track.id } }} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} hitSlop={{ top: 6, bottom: 2, right: 8 }} style={styles.link}>
        <Text numberOfLines={1} style={{ color: current ? theme.accent : theme.text, fontSize: 14 * theme.scale, lineHeight: lines[0], fontWeight: '600' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <View pointerEvents="box-none" style={styles.meta}>
        <Link href={{ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } }} asChild><Pressable accessibilityRole="link" accessibilityLabel={who} hitSlop={{ top: 2, bottom: 6, right: 4 }} style={styles.who}>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale, lineHeight: lines[1], fontWeight: '600' }}>{who}</Text>
        </Pressable></Link>
        {!!when && <Text pointerEvents="none" numberOfLines={1} style={{ color: theme.faint, fontSize: 12 * theme.scale, lineHeight: lines[1], flexShrink: 0 }}> · {when}</Text>}
      </View>
    </View>
    <Text pointerEvents="none" style={{ color: theme.faint, fontSize: 12 * theme.scale, fontVariant: ['tabular-nums'] }}>{formatDuration(track.metadata.duration_seconds)}</Text>
    {menu}
  </View></GestureDetector>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  art: { width: 48, height: 48 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  link: { justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  meta: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  who: { flexShrink: 1, minWidth: 0 },
  each: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
