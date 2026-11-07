import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { api, type Track } from './api';
import { Cover, Heading, Status, artistName, errorMessage, useColors, type Play } from './CatalogPieces';
import { Choice } from './AccountPieces';
import { HomeTrackActions } from './HomeTrackRow';
import { periodLabels, periods, type ChartPeriod } from './home-state';
import { PlayerControl } from './PlayerControl';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';

export function HomeChart({ onPlay }: { onPlay: Play }) {
  const colors = useColors();
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const [choosing, setChoosing] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const trigger = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!choosing || Platform.OS !== 'web') return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !(event.target instanceof Element) || !event.target.closest('[data-testid="home-chart"]')) return;
      event.preventDefault();
      setChoosing(false);
      trigger.current?.focus();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [choosing]);
  const load = useCallback(async (candidate: ChartPeriod) => {
    const request = ++generation.current;
    setPeriod(candidate);
    setTracks([]);
    setPage(0);
    setLoading(true);
    setError(undefined);
    try {
      const result = (await api.chart(candidate)).data.slice(0, 10).map(({ track }) => track);
      if (request === generation.current) setTracks(result);
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load('month'); return () => { generation.current++; }; }, [load]);
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
        <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[period]}`}
          accessibilityState={{ expanded: choosing }} onPress={() => setChoosing(value => !value)}
          style={({ pressed }) => [styles.period, { backgroundColor: pressed || choosing ? colors.surface : 'transparent', borderColor: colors.surface }]}>
          <Text style={{ color: colors.muted, fontSize: 13 * colors.scale }}>{periodLabels[period]}</Text>
          <ChevronDown size={14} color={colors.muted} style={{ transform: [{ rotate: choosing ? '180deg' : '0deg' }] }} />
        </Pressable>
      </View>
      {pages > 1 && <View style={styles.paging}>
        <PlayerControl icon={ChevronLeft} label="Previous top tracks" disabled={visiblePage === 0} onPress={() => setPage(Math.max(0, visiblePage - 1))} />
        <PlayerControl icon={ChevronRight} label="Next top tracks" disabled={visiblePage === pages - 1} onPress={() => setPage(Math.min(pages - 1, visiblePage + 1))} />
      </View>}
    </View>
    {choosing && <View role="group" accessibilityLabel="Top tracks period" onAccessibilityEscape={() => setChoosing(false)}
      style={[styles.choices, { backgroundColor: colors.surface }]}>
      {periods.map(candidate => <Choice key={candidate} label={periodLabels[candidate]} selected={candidate === period}
        onPress={() => { setChoosing(false); if (candidate !== period) void load(candidate); }} />)}
    </View>}
    {width > 0 && tracks.length > 0 && <View style={[styles.cards, { gap }]}>
      {tracks.slice(visiblePage * columns, (visiblePage + 1) * columns).map(track => <View key={track.id} style={{ width: size, minWidth: 0, gap: 2 }}>
        <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)}>
          <Cover uri={track.media.artwork?.url ?? track.artist.profile.avatar_url} size={size} radius={9} />
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
    {loading ? <View style={{ minHeight: (width > 0 ? size : 136) + 66, justifyContent: 'center' }}><WaveLoading label="loading top tracks..." /></View> : <Status error={error} retry={() => void load(period)}
      empty={!tracks.length ? period === 'all_time' ? 'nothing liked yet' : `nothing liked in the ${periodLabels[period]}` : undefined} />}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  scope: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  period: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1 },
  paging: { flexDirection: 'row', alignItems: 'center' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 6, borderRadius: 12 },
  cards: { flexDirection: 'row', alignItems: 'flex-start' }, metadata: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  title: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  announcement: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
