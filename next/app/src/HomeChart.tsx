import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, type Track } from './api';
import { Cover, Heading, Status, artistName, errorMessage, type Play } from './CatalogPieces';
import { HomeShelf } from './HomeShelf';
import { cardSurface } from './materials';
import { nextPopulatedChart, periodLabels, type ChartPeriod } from './home-state';
import { Text } from './Text';

export function HomeChart({ onPlay }: { onPlay: Play }) {
  const colors = useAppearance();
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (candidate: ChartPeriod, cycle = false) => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const read = async (period: ChartPeriod) => (await api.chart(period)).data.slice(0, 10).map(({ track }) => track);
      const result = cycle ? await nextPopulatedChart(candidate, read) : { period: candidate, tracks: await read(candidate) };
      if (request === generation.current) { setPeriod(result.period); setTracks(result.tracks); }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }, []);
  useEffect(() => { void load('month'); return () => { generation.current++; pending.current = false; }; }, [load]);
  const lines = [14, 12, 11].map(size => Math.ceil(size * colors.scale * 1.3));
  const card = [cardSurface(colors), styles.card, { width: 220 * colors.scale }];
  return <View style={styles.section}>
    <HomeShelf testID="home-chart" label="top tracks" busy={loading && !tracks.length} heading={<>
      <Heading>top tracks</Heading>
      <Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[period]}`}
        accessibilityHint="Show the next period with tracks" accessibilityState={{ busy: loading, disabled: loading }} disabled={loading}
        onPress={() => void load(period, true)}
        style={({ pressed }) => [styles.period, { opacity: pressed || loading ? 0.6 : 1 }]}>
        <Text style={{ color: colors.accent, fontSize: 13 * colors.scale }}>{periodLabels[period]}</Text>
      </Pressable>
    </>}>
      {loading && !tracks.length ? [0, 1, 2].map(index => <View key={index} accessibilityRole={index ? undefined : 'progressbar'} accessibilityLabel={index ? undefined : 'loading top tracks...'} style={card}>
        <View style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: colors.raised }} />
        <View style={{ flex: 1, height: lines[0] + lines[1] + lines[2] + 2, justifyContent: 'center' }}><View style={{ width: '70%', height: 10 * colors.scale, borderRadius: 5, backgroundColor: colors.raised }} /></View>
      </View>) : tracks.map(track => <Pressable key={track.id} testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track)}
        style={({ pressed }) => StyleSheet.flatten([card, pressed && { backgroundColor: colors.hover }])}>
        <Cover uri={trackArtwork(track)} size={48} radius={6} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14 * colors.scale, lineHeight: lines[0], fontWeight: '600' }}>{track.metadata.title}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 * colors.scale, lineHeight: lines[1] }}>{artistName(track)}</Text>
          <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 11 * colors.scale, lineHeight: lines[2] }}>{track.metrics.like_count} {track.metrics.like_count === 1 ? 'like' : 'likes'}</Text>
        </View>
      </Pressable>)}
    </HomeShelf>
    {!loading && <Status error={error} retry={() => void load(period)}
      empty={!tracks.length ? period === 'all_time' ? 'nothing liked yet' : `nothing liked in the ${periodLabels[period]}` : undefined} />}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  period: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  text: { flex: 1, minWidth: 0, gap: 1 },
});
