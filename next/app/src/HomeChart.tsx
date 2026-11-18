import { useAppearance } from './appearance';
import { Link } from 'expo-router';
import { trackArtwork } from '@plyr/next-core/artwork';
import { Pressable, StyleSheet, View } from 'react-native';
import { Cover, Heading, Status, artistName, type Play } from './CatalogPieces';
import { HomeShelf } from './HomeShelf';
import { cardSurface } from './materials';
import { periodLabels } from './home-state';
import { useTopTracks } from './use-top-tracks';
import { Text } from './Text';
import { PlayingArtworkOverlay } from './PlayingWave';
import { useTrackPlayback } from './playback-context';
import { useTrackPress } from './TrackPress';
import type { Track } from '@plyr/next-core/api';
import type { StyleProp, ViewStyle } from 'react-native';

export function HomeChart({ onPlay }: { onPlay: Play }) {
  const colors = useAppearance();
  const { period, tracks, loading, error, retry, cycle } = useTopTracks();
  const lines = [14, 12, 11].map(size => Math.ceil(size * colors.scale * 1.3));
  const card = [cardSurface(colors), styles.card, { width: 220 * colors.scale }];
  return <View style={styles.section}>
    <HomeShelf testID="home-chart" label="top tracks" busy={loading && !tracks.length} heading={<>
      <Heading>top tracks</Heading>
      <Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[period]}`}
        accessibilityHint="Show the next period with tracks" accessibilityState={{ busy: loading, disabled: loading }} disabled={loading}
        onPress={cycle}
        style={({ pressed }) => [styles.period, { opacity: pressed || loading ? 0.6 : 1 }]}>
        <Text style={{ color: colors.accent, fontSize: 13 * colors.scale }}>{periodLabels[period]}</Text>
      </Pressable>
    </>}>
      {loading && !tracks.length ? [0, 1, 2].map(index => <View key={index} accessibilityRole={index ? undefined : 'progressbar'} accessibilityLabel={index ? undefined : 'loading top tracks...'} style={card}>
        <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: colors.raised }} />
        <View style={{ flex: 1, height: lines[0] + lines[1] + lines[2] + 2, justifyContent: 'center' }}><View style={{ width: '70%', height: 10 * colors.scale, borderRadius: 5, backgroundColor: colors.raised }} /></View>
      </View>) : tracks.map(track => <ChartTrack key={track.id} track={track} onPlay={onPlay} card={card} lines={lines} />)}
    </HomeShelf>
    {!loading && <Status error={error} retry={retry}
      empty={!tracks.length ? period === 'all_time' ? 'nothing liked yet' : `nothing liked in the ${periodLabels[period]}` : undefined} />}
  </View>;
}

function ChartTrack({ track, onPlay, card, lines }: { track: Track; onPlay: Play; card: StyleProp<ViewStyle>; lines: number[] }) {
  const colors = useAppearance();
  const { playing, toggle } = useTrackPlayback(track);
  const { row, press, menu } = useTrackPress(track);
  return <View ref={row} testID="home-chart-track" style={card}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.metadata.title}`} {...press} onPress={() => toggle(() => onPlay(track))}
      style={({ pressed }) => [StyleSheet.absoluteFill, { borderRadius: 8, backgroundColor: pressed ? colors.hover : 'transparent' }]} />
    <View pointerEvents="none">
      <Cover uri={trackArtwork(track)} size={48} radius={6} />
      {playing && <PlayingArtworkOverlay />}
    </View>
    <View pointerEvents="box-none" style={styles.text}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} {...press} hitSlop={{ top: 6, bottom: 2, right: 8 }} style={styles.link}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14 * colors.scale, lineHeight: lines[0], fontWeight: '600' }}>{track.metadata.title}</Text>
      </Pressable></Link>
      <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" {...press} hitSlop={{ top: 2, bottom: 6, right: 8 }} style={styles.link}>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 * colors.scale, lineHeight: lines[1] }}>{artistName(track)}</Text>
      </Pressable></Link>
      <View pointerEvents="none"><Text numberOfLines={1} style={{ color: colors.faint, fontSize: 11 * colors.scale, lineHeight: lines[2] }}>{track.metrics.like_count} {track.metrics.like_count === 1 ? 'like' : 'likes'}</Text></View>
    </View>
    {menu}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  period: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  link: { justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
});
