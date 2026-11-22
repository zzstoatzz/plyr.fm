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
import { followingShelfSize } from '@plyr/next-core/following-latest';
import { Cover, type Play } from './CatalogPieces';
import type { NetworkArtist } from './home-api';
import { formatDuration, timeAgo } from './home-state';
import { Shuffle } from './icons';
import { cardSurface } from './materials';
import { Text } from './Text';

const newest = new Map<string, Promise<Track[]>>();

/** One read for everyone's newest track; artists past the endpoint's 500 go in further reads. */
function latestFrom(key: string) {
  let load = newest.get(key);
  if (!load) {
    const dids = key.split(',');
    const batches = Array.from({ length: Math.ceil(dids.length / 500) }, (_, index) => dids.slice(index * 500, index * 500 + 500));
    load = Promise.all(batches.map(batch => api.latestTracks(batch, followingShelfSize))).then(found => found.flat()
      .sort((a, b) => Date.parse(b.metadata.created_at) - Date.parse(a.metadata.created_at))
      .slice(0, followingShelfSize));
    load.catch(() => newest.delete(key));
    newest.set(key, load);
    if (newest.size > 4) { const first = newest.keys().next().value; if (first) newest.delete(first); }
  }
  return load;
}

/** The newest track from each artist you follow, newest first. */
export function useFollowingLatest(artists: NetworkArtist[]) {
  const [tracks, setTracks] = useState<{ key: string; data: Track[] }>({ key: '', data: [] });
  const key = artists.map(artist => artist.did).join(',');
  useEffect(() => {
    if (!key) return;
    let live = true;
    void latestFrom(key).then(data => { if (live) setTracks({ key, data }); }, () => { if (live) setTracks({ key, data: [] }); });
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
  const lines = [14, 12, 11].map(size => Math.ceil(size * theme.scale * 1.3));
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
      <Link href={{ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } }} asChild><Pressable accessibilityRole="link" accessibilityLabel={who} hitSlop={{ top: 2, bottom: 6, right: 8 }} style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale, lineHeight: lines[1] }}>{who}</Text>
      </Pressable></Link>
      <View pointerEvents="none"><Text numberOfLines={1} style={{ color: theme.faint, fontSize: 11 * theme.scale, lineHeight: lines[2], fontVariant: ['tabular-nums'] }}>
        {[timeAgo(track.metadata.created_at, now), formatDuration(track.metadata.duration_seconds)].filter(Boolean).join(' · ')}
      </Text></View>
    </View>
    {menu}
  </View></GestureDetector>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  art: { width: 48, height: 48 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  link: { justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  each: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
