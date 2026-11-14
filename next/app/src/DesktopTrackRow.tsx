import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { artistName, Cover, type Play } from './CatalogPieces';
import { compactCount, formatDuration, timeAgo } from './home-state';
import { HomeTrackActions } from './HomeTrackRow';
import { Headphones, Heart } from './icons';
import { Text } from './Text';

/** A track as one line of a wide list: cover, title, artist and age, then listens, likes, length and the track menu. */
export function DesktopTrackRow({ track, tracks, onPlay, rank, now, returnTo = '/' }: { track: Track; tracks: Track[]; onPlay: Play; rank?: number; now?: number; returnTo?: string }) {
  const theme = useAppearance();
  const stat = { color: theme.muted, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums' as const] };
  const { play_count: plays, like_count: likes } = track.metrics;
  const age = now === undefined ? '' : timeAgo(track.metadata.created_at, now);
  const when = age === 'now' ? 'just now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : age;
  return <View testID="home-track-row" style={styles.row}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [StyleSheet.absoluteFill, { borderRadius: 10, backgroundColor: pressed || hovered ? theme.hover : 'transparent' }]} />
    {rank !== undefined && <Text pointerEvents="none" style={[stat, styles.rank, { color: theme.faint }]}>{rank}</Text>}
    <View pointerEvents="none"><Cover uri={trackArtwork(track)} size={48} radius={6} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <View pointerEvents="box-none" style={styles.byline}>
        <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={StyleSheet.flatten([styles.link, { flexShrink: 1 }])}>
          <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>{artistName(track)}</Text>
        </Pressable></Link>
        {when ? <Text pointerEvents="none" numberOfLines={1} style={{ color: theme.faint, fontSize: 13 * theme.scale }}>· {when}</Text> : null}
      </View>
    </View>
    <View pointerEvents="none" accessibilityLabel={`${plays} ${plays === 1 ? 'play' : 'plays'}, ${likes} ${likes === 1 ? 'like' : 'likes'}`} style={styles.stats}>
      <View style={styles.stat}><Headphones size={15} color={theme.faint} /><Text style={[stat, styles.count]}>{compactCount(plays)}</Text></View>
      <View style={styles.stat}>{likes > 0 && <><Heart size={14} color={theme.faint} /><Text style={[stat, styles.count]}>{compactCount(likes)}</Text></>}</View>
      <Text style={[stat, styles.duration]}>{formatDuration(track.metadata.duration_seconds)}</Text>
    </View>
    <HomeTrackActions track={track} returnTo={returnTo} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingLeft: 10, paddingRight: 2, marginHorizontal: -10 },
  rank: { width: 18, textAlign: 'right' },
  meta: { flex: 1, minWidth: 0 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  link: { minHeight: 22, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  // fixed cells with the icon first, so icons stay in a column whatever the count (132.1k at most)
  stats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stat: { width: 70, flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { flex: 1, textAlign: 'left' },
  duration: { width: 58, textAlign: 'right' },
});
