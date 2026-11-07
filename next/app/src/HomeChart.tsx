import { trackArtwork } from './artwork';
import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { api, type Track } from './api';
import { Cover, Heading, Status, artistName, errorMessage, useColors, type Play } from './CatalogPieces';
import { HomeTrackActions } from './HomeTrackRow';
import { nextPopulatedChart, periodLabels, type ChartPeriod } from './home-state';
import { PlayerControl } from './PlayerControl';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';

export function HomeChart({ onPlay }: { onPlay: Play }) {
  const colors = useColors();
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
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
      if (request === generation.current) { setPeriod(result.period); setTracks(result.tracks); setPage(0); }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) { pending.current = false; setLoading(false); }
    }
  }, []);
  useEffect(() => { void load('month'); return () => { generation.current++; pending.current = false; }; }, [load]);
  const gap = 16;
  const ideal = (width >= 700 ? 150 : 120) * colors.scale;
  const columns = Math.max(1, Math.min(6, Math.floor((width + gap) / (ideal + gap))));
  const size = Math.max(1, (width - gap * (columns - 1)) / columns);
  const pages = Math.max(1, Math.ceil(tracks.length / columns));
  const visiblePage = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [columns]);
  return <View testID="home-chart" style={styles.section} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.header}>
      <View style={styles.scope}>
        <Heading>top tracks</Heading>
        <Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[period]}`}
          accessibilityHint="Show the next period with tracks" accessibilityState={{ busy: loading, disabled: loading }} disabled={loading}
          onPress={() => void load(period, true)}
          style={({ pressed }) => [styles.period, { opacity: pressed || loading ? 0.6 : 1 }]}>
          <Text style={{ color: colors.muted, fontSize: 13 * colors.scale }}>{periodLabels[period]}</Text>
        </Pressable>
      </View>
      {pages > 1 && <View style={styles.paging}>
        <PlayerControl icon={ChevronLeft} label="Previous top tracks" disabled={visiblePage === 0} onPress={() => setPage(Math.max(0, visiblePage - 1))} />
        <PlayerControl icon={ChevronRight} label="Next top tracks" disabled={visiblePage === pages - 1} onPress={() => setPage(Math.min(pages - 1, visiblePage + 1))} />
      </View>}
    </View>
    {width > 0 && tracks.length > 0 && <View style={[styles.cards, { gap }]}>
      {tracks.slice(visiblePage * columns, (visiblePage + 1) * columns).map(track => <View key={track.id} style={{ width: size, minWidth: 0, gap: 2 }}>
        <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track)}>
          <Cover uri={trackArtwork(track)} size={size} radius={9} />
        </Pressable>
        <View style={styles.metadata}>
          <Link href={{ pathname: '/track/[id]', params: { id: track.id } }} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.title}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 * colors.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
            </Pressable>
          </Link>
          <HomeTrackActions track={track} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 * colors.scale }}>{artistName(track)}</Text>
      </View>)}
    </View>}
    {tracks.length > 0 && <Text accessibilityLiveRegion="polite" style={styles.announcement}>Top tracks page {visiblePage + 1} of {pages}</Text>}
    {loading && !tracks.length ? <View style={{ minHeight: (width > 0 ? size : 136) + 66, justifyContent: 'center' }}><WaveLoading label="loading top tracks..." /></View> : <Status error={error} retry={() => void load(period)}
      empty={!tracks.length ? period === 'all_time' ? 'nothing liked yet' : `nothing liked in the ${periodLabels[period]}` : undefined} />}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  scope: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  period: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  paging: { flexDirection: 'row', alignItems: 'center' },
  cards: { flexDirection: 'row', alignItems: 'flex-start' }, metadata: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  title: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  announcement: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
