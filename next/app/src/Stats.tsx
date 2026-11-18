import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { trackArtwork } from '@plyr/next-core/artwork';
import { api } from './api-client';
import { useAppearance } from './appearance';
import { Choice } from './AccountPieces';
import { CatalogMetrics } from './CatalogMetrics';
import { catalogRuntime } from '@plyr/next-core/catalog/runtime';
import { Cover, Heading, Status, artistName, useResource } from './CatalogPieces';
import { Copy, Field, Page, row } from './controls';
import { ArrowClockwise } from './icons';
import { compactCount } from './home-state';
import { Text } from './Text';

const ranges = [
  { period: 'week', label: '7 days' },
  { period: 'month', label: '30 days' },
  { period: 'all_time', label: 'all time' },
] as const;
type Period = typeof ranges[number]['period'];

export default function Stats() {
  const theme = useAppearance();
  const result = useResource(api.stats, 0, true);
  const [query, setQuery] = useState('');
  const term = query.trim().replace(/^@/, '');
  const stats = result.data;
  return <Page title="stats">
    <View style={styles.section}>
      <Heading>artist stats</Heading>
      <Field label="find an artist" placeholder="artist name or @handle" value={query} onChangeText={setQuery}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" maxLength={100} />
      {[...term].length >= 2 && <ArtistMatches key={term} term={term} />}
    </View>
    {stats ? <CatalogMetrics lead={{ label: 'total plays', value: stats.plays.toLocaleString() }} metrics={[
      { label: 'tracks', value: stats.tracks.toLocaleString() },
      { label: 'artists', value: stats.artists.toLocaleString() },
      { label: 'catalog runtime', value: catalogRuntime(stats.duration_seconds) },
    ]} /> : <Status loading={!result.error} error={result.error && 'couldn’t load catalog totals.'} retry={result.retry} />}
    <TrackChart />
    {stats && <View style={[row, { justifyContent: 'flex-end' }]}>
      <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>
        updated {new Date(stats.updated_at_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh catalog totals" onPress={result.retry} style={styles.refresh}>
        <ArrowClockwise size={18} color={theme.muted} />
      </Pressable>
    </View>}
  </Page>;
}

function ArtistMatches({ term }: { term: string }) {
  const theme = useAppearance();
  const load = useCallback(() => api.search(term, { types: 'artist', limit: 6 }), [term]);
  const matches = useResource(load, 180);
  if (!matches.data) return <Status loading={!matches.error} error={matches.error && 'couldn’t find artists.'} retry={matches.retry} />;
  if (!matches.data.data.length) return <Copy live>no artists found for “{term}”.</Copy>;
  return <View>{matches.data.data.map(artist => <Link key={artist.id} href={{ pathname: '/u/[handle]', params: { handle: artist.id } }} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={`Stats for ${artist.title}, @${artist.owner.handle}`}
      style={{ ...styles.line, borderColor: theme.hairline }}>
      <Cover uri={artist.image_url} size={38} round />
      <View style={styles.name}>
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 * theme.scale }}>{artist.title}</Text>
        <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>@{artist.owner.handle}</Text>
      </View>
      <Text style={{ color: theme.muted, fontSize: 21 * theme.scale }}>›</Text>
    </Pressable>
  </Link>)}</View>;
}

function TrackChart() {
  const [period, setPeriod] = useState<Period>('month');
  return <View style={styles.section}>
    <Heading>most liked tracks</Heading>
    <View style={row}>{ranges.map(range => <Choice key={range.period} label={range.label} selected={period === range.period} onPress={() => setPeriod(range.period)} />)}</View>
    <TrackRanking key={period} period={period} />
  </View>;
}

function TrackRanking({ period }: { period: Period }) {
  const theme = useAppearance();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale * theme.scale > 1.35;
  const load = useCallback(() => api.chart(period, 5), [period]);
  const ranking = useResource(load);
  if (!ranking.data) return <Status loading={!ranking.error} error={ranking.error && 'couldn’t load the track chart.'} retry={ranking.retry} />;
  if (!ranking.data.data.length) return <Copy live>no likes in this time range.</Copy>;
  return <View>
    {!stacked && <View style={styles.columnLabels}>
      <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>track</Text>
      <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>likes</Text>
    </View>}
    {ranking.data.data.map(({ rank, track, period_like_count }) => <Link key={track.id}
      href={{ pathname: '/track/[id]', params: { id: track.id } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`Rank ${rank}, ${track.metadata.title}, ${artistName(track)}, ${period_like_count} likes`}
        style={{ ...styles.line, borderColor: theme.hairline }}>
        <Text style={[styles.count, { color: theme.muted, fontSize: 13 * theme.scale }]}>{rank}</Text>
        <Cover uri={trackArtwork(track)} size={40} radius={6} />
        <View style={styles.name}>
          <Text numberOfLines={stacked ? undefined : 2} style={{ color: theme.text, fontWeight: '700', fontSize: 15 * theme.scale }}>{track.metadata.title}</Text>
          <Text numberOfLines={stacked ? undefined : 2} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{artistName(track)}</Text>
          {stacked && <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{period_like_count.toLocaleString()} {period_like_count === 1 ? 'like' : 'likes'}</Text>}
        </View>
        {!stacked && <Text style={[styles.count, { color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }]}>{compactCount(period_like_count)}</Text>}
      </Pressable>
    </Link>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  line: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  name: { flex: 1, minWidth: 0, gap: 2 },
  count: { minWidth: 13, textAlign: 'right', fontVariant: ['tabular-nums'] },
  refresh: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  columnLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 22, paddingBottom: 6 },
});
