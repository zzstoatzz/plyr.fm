import { Link } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { AtlasView } from './atlas/AtlasView';
import { trackArtwork } from './artwork';
import { useAuth } from './auth';
import { Cover, Status, type Play } from './CatalogPieces';
import { DesktopTrackRow } from './DesktopTrackRow';
import { dayGroup, periodLabels } from './home-state';
import { HomeFeatured, useFeaturedArtist } from './HomeFeatured';
import { HomeTagBar } from './HomeTagBar';
import { ArrowsOut } from './icons';
import { cardSurface } from './materials';
import { Text } from './Text';
import { useLatestFeed } from './use-latest-feed';
import { useNetworkArtists } from './use-network-artists';
import { useTopTracks } from './use-top-tracks';
import { WaveLoading } from './WaveLoading';

/** Window width from which home lays out as a page with a rail instead of the phone feed. */
export const DESKTOP_HOME_WIDTH = 1100;
const RAIL = 340;

function Section({ title, aside, children, testID }: { title: string; aside?: ReactNode; children: ReactNode; testID?: string }) {
  const theme = useAppearance();
  return <View testID={testID} style={styles.section}>
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" aria-level={2} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 19 * theme.scale, fontWeight: '700', letterSpacing: -0.3 }}>{title}</Text>
      {aside}
    </View>
    {children}
  </View>;
}

function AtlasTile({ onPlay, wide }: { onPlay: Play; wide: boolean }) {
  const theme = useAppearance();
  const [summary, setSummary] = useState<string>();
  return <View testID="home-atlas" style={[cardSurface(theme), styles.atlas, wide ? { flex: 1, height: 300 } : { width: RAIL }]}>
    <AtlasView preview onPlay={track => onPlay(track)} onSummary={setSummary} />
    <View pointerEvents="box-none" style={styles.atlasCaption}>
      <View pointerEvents="none" style={{ flexShrink: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }}>atlas</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{summary ?? 'the catalog, mapped by sound'}</Text>
      </View>
      <Link href="/atlas" asChild><Pressable accessibilityRole="link" accessibilityLabel="Open the atlas"
        style={StyleSheet.flatten([styles.expand, { backgroundColor: theme.surface, borderColor: theme.line }])}>
        <ArrowsOut size={15} color={theme.text} />
        <Text style={{ color: theme.text, fontSize: 13 * theme.scale, fontWeight: '600' }}>explore</Text>
      </Pressable></Link>
    </View>
  </View>;
}

function TopTracks({ onPlay }: { onPlay: Play }) {
  const theme = useAppearance();
  const top = useTopTracks('month', 6);
  return <Section testID="home-chart" title="top tracks" aside={<Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[top.period]}`}
    accessibilityHint="Show the next period with tracks" disabled={top.loading} onPress={top.cycle} style={styles.period}>
    <Text style={{ color: theme.accent, fontSize: 13 * theme.scale, opacity: top.loading ? 0.6 : 1 }}>{periodLabels[top.period]}</Text>
  </Pressable>}>
    {top.loading && !top.tracks.length ? <WaveLoading label="loading top tracks..." />
      : top.tracks.map((track, index) => <DesktopRailTrack key={track.id} rank={index + 1} track={track} onPress={() => onPlay(track, top.tracks)} />)}
    {!top.loading && <Status error={top.error} retry={top.retry} empty={!top.tracks.length ? `nothing liked in the ${periodLabels[top.period]}` : undefined} />}
  </Section>;
}

function DesktopRailTrack({ track, rank, onPress }: { track: Track; rank: number; onPress: () => void }) {
  const theme = useAppearance();
  return <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={onPress}
    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.railTrack, { backgroundColor: pressed || hovered ? theme.hover : 'transparent' }]}>
    <Text style={{ width: 16, textAlign: 'right', color: theme.faint, fontSize: 12 * theme.scale, fontVariant: ['tabular-nums'] }}>{rank}</Text>
    <Cover uri={trackArtwork(track)} size={44} radius={6} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale }}>{track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle}</Text>
    </View>
    <Text style={{ color: theme.faint, fontSize: 12 * theme.scale, fontVariant: ['tabular-nums'] }}>{track.metrics.like_count} {track.metrics.like_count === 1 ? 'like' : 'likes'}</Text>
  </Pressable>;
}

function ArtistsYouKnow() {
  const theme = useAppearance();
  const { did, ready } = useAuth();
  const network = useNetworkArtists(did, ready);
  if (!did || !network.loading && !network.error && !network.artists.length) return null;
  return <Section testID="home-artists" title="artists you know">
    {network.loading ? <WaveLoading label="finding artists you follow..." /> : <View style={styles.people}>
      {network.artists.slice(0, 12).map(artist => <Link key={artist.did} href={{ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={artist.display_name || artist.handle} style={styles.person}>
          <Cover uri={artist.avatar_url} size={60} round />
          <Text numberOfLines={1} style={{ maxWidth: '100%', color: theme.muted, fontSize: 12 * theme.scale, textAlign: 'center' }}>{artist.display_name || artist.handle}</Text>
        </Pressable>
      </Link>)}
    </View>}
    <Status error={network.error} retry={network.retry} />
  </Section>;
}

export function DesktopHome({ onPlay, hiddenTags }: { onPlay: Play; hiddenTags: string[] }) {
  const theme = useAppearance();
  const feed = useLatestFeed(hiddenTags);
  const { latest, tracks, pending, selected } = feed;
  const featured = useFeaturedArtist();
  const scroller = useRef<ScrollViewInstance>(null);
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const [now] = useState(() => Date.now());
  const fill = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 1.5 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  const groups = useMemo(() => {
    const out: { label: string; tracks: typeof tracks }[] = [];
    for (const track of tracks) {
      const label = dayGroup(track.metadata.created_at, now);
      if (out.at(-1)?.label === label) out.at(-1)!.tracks.push(track);
      else out.push({ label, tracks: [track] });
    }
    return out;
  }, [tracks, now]);
  const hasFeature = featured.status !== 'empty';
  return <ScrollView ref={scroller} testID="home-feed" style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={styles.page}
    accessibilityState={{ busy: latest.loading }} scrollEventThrottle={32}
    onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; fill(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fill(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; fill(); }}>
    <View style={styles.top}>
      {hasFeature && <View style={{ flex: 1, minWidth: 0 }}><HomeFeatured featured={featured} onPlay={onPlay} /></View>}
      <AtlasTile onPlay={onPlay} wide={!hasFeature} />
    </View>
    <View style={styles.columns}>
      <View style={styles.main}>
        <Section title="latest" aside={<Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { scroller.current?.scrollTo({ y: 0, animated: false }); latest.reload(); }} style={styles.period}>
          <Text style={{ color: theme.faint, fontSize: 13 * theme.scale }}>newest first</Text>
        </Pressable>}>
          <HomeTagBar feed={feed} hiddenTags={hiddenTags} />
          <View style={{ opacity: pending ? 0.5 : 1 }}>
            {groups.map(group => <View key={group.label + group.tracks[0].id}>
              <Text accessibilityRole="header" aria-level={3} style={[styles.day, { color: theme.faint, fontSize: 12 * theme.scale }]}>{group.label}</Text>
              {group.tracks.map(track => <DesktopTrackRow key={track.id} track={track} tracks={tracks} onPlay={onPlay} now={now} />)}
            </View>)}
          </View>
          <View testID="home-feed-footer" style={styles.footer}>
            {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
              <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
            {tracks.length > 0 && latest.error && <Pressable accessibilityRole="button" onPress={latest.more} style={styles.period}><Text style={{ color: theme.accent }}>retry loading tracks</Text></Pressable>}
            <Text accessibilityLiveRegion="polite" style={styles.live}>{tracks.length} tracks loaded</Text>
          </View>
        </Section>
      </View>
      <View style={styles.rail}>
        <TopTracks onPlay={onPlay} />
        <ArtistsYouKnow />
      </View>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 1320, alignSelf: 'center', paddingHorizontal: 36, paddingTop: 28, paddingBottom: 40, gap: 34 },
  top: { flexDirection: 'row', gap: 28, alignItems: 'stretch', minHeight: 300 },
  atlas: { borderRadius: 18, overflow: 'hidden', minHeight: 300 },
  atlasCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, padding: 14 },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1 },
  columns: { flexDirection: 'row', gap: 40, alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0 },
  rail: { width: RAIL, gap: 34 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  period: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  railTrack: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  people: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  person: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 4, minHeight: 44 },
  day: { fontWeight: '700', letterSpacing: 0.3, paddingTop: 18, paddingBottom: 6 },
  footer: { minHeight: 96, justifyContent: 'center' },
  live: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
