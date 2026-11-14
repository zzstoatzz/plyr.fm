import { Link } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { AtlasView } from './atlas/AtlasView';
import { trackArtwork } from './artwork';
import { useAuth } from './auth';
import { Cover, Status, type Play } from './CatalogPieces';
import { DesktopTrackRow } from './DesktopTrackRow';
import { compactCount, periodLabels } from './home-state';
import { HomeFeatured, useFeaturedArtist } from './HomeFeatured';
import { HomeTagBar } from './HomeTagBar';
import { ArrowRight } from './icons';
import { cardSurface } from './materials';
import { wideFrame } from './controls';
import { Text } from './Text';
import { useLatestFeed } from './use-latest-feed';
import { useNetworkArtists } from './use-network-artists';
import { FollowingTrack, PlayOneFromEach, useFollowingLatest } from './FollowingLatest';
import { useTopTracks } from './use-top-tracks';
import { WaveLoading } from './WaveLoading';

/** Window width from which home lays out as a page with a rail instead of the phone feed. */
export const DESKTOP_HOME_WIDTH = 1240;
const RAIL = 340;
/** Below this window width the rail narrows so the main column keeps room for titles. */
const ROOMY = 1480;
const FOLLOWING = 5;
const RAIL_STEP = 8;

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

/** A still, live picture of the atlas. The whole card opens it; nothing inside is interactive. */
function AtlasTile() {
  const theme = useAppearance();
  const [summary, setSummary] = useState<string>();
  const [hovered, setHovered] = useState(false);
  return <Link href="/atlas" asChild><Pressable testID="home-atlas" accessibilityRole="link" accessibilityLabel={`Open the atlas${summary ? `, ${summary}` : ''}`}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([cardSurface(theme), styles.atlas, hovered && { borderColor: theme.border }])}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}><AtlasView preview onSummary={setSummary} /></View>
    <View pointerEvents="none" style={styles.atlasCaption}>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }}>atlas</Text>
        <Text numberOfLines={2} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{summary ?? 'the catalog, mapped by sound'}</Text>
      </View>
      <View style={[styles.expand, { backgroundColor: hovered ? theme.text : theme.surface, borderColor: theme.line }]}>
        <ArrowRight size={16} color={hovered ? theme.background : theme.text} />
      </View>
    </View>
  </Pressable></Link>;
}

function TopTracks({ onPlay, top, shown }: { onPlay: Play; top: ReturnType<typeof useTopTracks>; shown: number }) {
  const theme = useAppearance();
  return <Section testID="home-chart" title="top tracks" aside={<Pressable accessibilityRole="button" accessibilityLabel={`Top tracks period: ${periodLabels[top.period]}`}
    accessibilityHint="Show the next period with tracks" disabled={top.loading} onPress={top.cycle} style={styles.period}>
    <Text style={{ color: theme.accent, fontSize: 13 * theme.scale, opacity: top.loading ? 0.6 : 1 }}>{periodLabels[top.period]}</Text>
  </Pressable>}>
    {top.loading && !top.tracks.length ? <WaveLoading label="loading top tracks..." />
      : top.tracks.slice(0, shown).map((track, index) => <DesktopRailTrack key={track.id} rank={index + 1} track={track} onPress={() => onPlay(track, top.tracks)} />)}
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
    <Text style={{ color: theme.faint, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums'] }}>{compactCount(track.metrics.like_count)} {track.metrics.like_count === 1 ? 'like' : 'likes'}</Text>
  </Pressable>;
}

function ArtistsYouKnow({ onPlay, now }: { onPlay: Play; now: number }) {
  const theme = useAppearance();
  const { did, ready } = useAuth();
  const network = useNetworkArtists(did, ready);
  const latest = useFollowingLatest(network.artists);
  const [all, setAll] = useState(false);
  if (!did || !network.loading && !network.error && !network.artists.length) return null;
  const loading = network.loading || latest.loading;
  const hidden = latest.tracks.length - FOLLOWING;
  return <Section testID="home-artists" title="new from people you follow" aside={<PlayOneFromEach tracks={latest.tracks} onPlay={onPlay} />}>
    {loading ? <WaveLoading label="finding what people you follow posted..." /> : <View style={styles.following}>
      {(all ? latest.tracks : latest.tracks.slice(0, FOLLOWING)).map(track => <FollowingTrack key={track.id} track={track} tracks={latest.tracks} onPlay={onPlay} now={now} />)}
    </View>}
    {!loading && hidden > 0 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: all }} onPress={() => setAll(value => !value)} style={styles.more}>
      <Text style={{ color: theme.accent, fontSize: 13.5 * theme.scale, fontWeight: '600' }}>{all ? 'show fewer' : `show all ${latest.tracks.length}`}</Text>
    </Pressable>}
    <Status error={network.error} retry={network.retry} />
  </Section>;
}

export function DesktopHome({ onPlay, hiddenTags }: { onPlay: Play; hiddenTags: string[] }) {
  const theme = useAppearance();
  const feed = useLatestFeed(hiddenTags);
  const { latest, tracks, pending, selected } = feed;
  const featured = useFeaturedArtist();
  const top = useTopTracks('month', 50);
  const rail = useWindowDimensions().width >= ROOMY ? RAIL : 300;
  const scroller = useRef<ScrollViewInstance>(null);
  const viewport = useRef({ height: 0, content: 0, offset: 0 });
  const [now] = useState(() => Date.now());
  const fill = useCallback(() => {
    const { height, content, offset } = viewport.current;
    if (height > 0 && content > 0 && content - offset - height <= height * 1.5 && latest.cursor && !latest.loading && !latest.error) latest.more();
  }, [latest.cursor, latest.loading, latest.error, latest.more]);
  // the rail keeps pace with latest, a row of top tracks for each row loaded there, up to the chart's 50
  const shown = Math.max(RAIL_STEP, tracks.length - RAIL_STEP);
  return <ScrollView ref={scroller} testID="home-feed" style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={styles.page}
    accessibilityState={{ busy: latest.loading }} scrollEventThrottle={32}
    onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; fill(); }}
    onContentSizeChange={(_, height) => { viewport.current.content = height; fill(); }}
    onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; fill(); }}>
    <View style={styles.hero}>
      {featured.status !== 'empty' && <View style={styles.main}><HomeFeatured featured={featured} onPlay={onPlay} /></View>}
      <View style={[styles.atlasSlot, { width: rail }, featured.status === 'empty' && { flex: 1 }]}><AtlasTile /></View>
    </View>
    <View style={styles.columns}>
      <View style={styles.main}>
        <Section title="latest" aside={<Pressable accessibilityRole="button" accessibilityLabel="Refresh tracks" onPress={() => { scroller.current?.scrollTo({ y: 0, animated: false }); latest.reload(); }} style={styles.period}>
          <Text style={{ color: theme.faint, fontSize: 13 * theme.scale }}>newest first</Text>
        </Pressable>}>
          <HomeTagBar feed={feed} hiddenTags={hiddenTags} />
          <View style={{ opacity: pending ? 0.5 : 1 }}>
            {tracks.map(track => <DesktopTrackRow key={track.id} track={track} tracks={tracks} onPlay={onPlay} now={now} />)}
          </View>
          <View testID="home-feed-footer" style={styles.footer}>
            {latest.loading ? <WaveLoading label={tracks.length ? 'loading more...' : 'loading tracks...'} /> :
              <Status error={latest.error} retry={tracks.length ? undefined : latest.more} empty={!tracks.length ? selected.length ? 'no tracks match these tags' : 'no tracks yet' : undefined} />}
            {tracks.length > 0 && latest.error && <Pressable accessibilityRole="button" onPress={latest.more} style={styles.period}><Text style={{ color: theme.accent }}>retry loading tracks</Text></Pressable>}
            <Text accessibilityLiveRegion="polite" style={styles.live}>{tracks.length} tracks loaded</Text>
          </View>
        </Section>
      </View>
      <View style={[styles.rail, { width: rail }]}>
        <ArtistsYouKnow onPlay={onPlay} now={now} />
        <TopTracks onPlay={onPlay} top={top} shown={shown} />
      </View>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { ...wideFrame, paddingTop: 28, paddingBottom: 40, gap: 36 },
  // the atlas takes the artist card's height, so the two read as one band
  hero: { flexDirection: 'row', gap: 40, alignItems: 'stretch' },
  atlasSlot: { minHeight: 300 },
  atlas: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  atlasCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, padding: 14 },
  expand: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1 },
  columns: { flexDirection: 'row', gap: 40, alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0 },
  rail: { gap: 34 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  period: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  railTrack: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  following: { gap: 8 },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  footer: { minHeight: 96, justifyContent: 'center' },
  live: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', color: 'transparent' },
});
