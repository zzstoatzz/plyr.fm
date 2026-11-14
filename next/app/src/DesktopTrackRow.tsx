import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { artistName, Cover, type Play } from './CatalogPieces';
import { formatDuration, timeAgo } from './home-state';
import { HomeTrackActions } from './HomeTrackRow';
import { Play as PlayIcon } from './icons';
import { Text } from './Text';

/** A track as one line of a wide list: cover, title and artist, plays, length, age and the track menu. */
export function DesktopTrackRow({ track, tracks, onPlay, rank, now, returnTo = '/' }: { track: Track; tracks: Track[]; onPlay: Play; rank?: number; now?: number; returnTo?: string }) {
  const theme = useAppearance();
  const small = { color: theme.faint, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums' as const] };
  const age = now === undefined ? '' : timeAgo(track.metadata.created_at, now);
  return <View testID="home-track-row" style={styles.row}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [StyleSheet.absoluteFill, { borderRadius: 10, backgroundColor: pressed || hovered ? theme.hover : 'transparent' }]} />
    {rank !== undefined && <Text pointerEvents="none" style={[small, styles.rank]}>{rank}</Text>}
    <View pointerEvents="none"><Cover uri={trackArtwork(track)} size={48} radius={6} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={styles.link}>
        <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>{artistName(track)}</Text>
      </Pressable></Link>
    </View>
    <View pointerEvents="none" accessibilityLabel={`${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'play' : 'plays'}`} style={styles.plays}>
      <Text style={small}>{track.metrics.play_count}</Text><PlayIcon size={11} color={theme.faint} />
    </View>
    <Text pointerEvents="none" style={[small, styles.column, styles.duration]}>{formatDuration(track.metadata.duration_seconds)}</Text>
    {age ? <Text pointerEvents="none" style={[small, styles.column, styles.age]}>{age}</Text> : null}
    <HomeTrackActions track={track} returnTo={returnTo} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingLeft: 10, paddingRight: 2, marginHorizontal: -10 },
  rank: { width: 18, textAlign: 'right' },
  meta: { flex: 1, minWidth: 0 },
  link: { minHeight: 22, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  column: { textAlign: 'right' },
  plays: { width: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  duration: { width: 64 },
  age: { width: 56 },
});
