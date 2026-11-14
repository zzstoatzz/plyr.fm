import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { api, type Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { Cover, type Play } from './CatalogPieces';
import { Action } from './controls';
import { compactCount, distinctTracks, formatDuration, rankedArtists, weekNumber } from './home-state';
import { Equalizer, Play as PlayIcon, Shuffle } from './icons';
import { usePlayback } from './playback';
import { PauseGlyph } from './PlayerGlyph';
import { cardSurface } from './materials';
import { Text } from './Text';

type Featured = { status: 'loading' } | { status: 'empty' } | { status: 'ready'; tracks: Track[] };

let daily: { day: string; load: Promise<Track[]> } | undefined;

async function loadFeatured(): Promise<Track[]> {
  const liked = (await api.chart('all_time', 50)).data.map(({ track }) => track);
  const ranked = rankedArtists(liked);
  if (!ranked.length) return [];
  const start = weekNumber() % ranked.length;
  let fallback: Track[] = [];
  // a week is better spent on an artist with a few tracks to sit with; try the next ones in turn
  for (let step = 0; step < Math.min(4, ranked.length); step++) {
    const did = ranked[(start + step) % ranked.length];
    const tracks = distinctTracks((await api.tracks({ artist_did: did, limit: 12 })).data);
    if (tracks.length >= 3) return tracks;
    if (!fallback.length) fallback = tracks;
  }
  return fallback;
}

/** The artist of the week, read once per page load and week. */
export function useFeaturedArtist(): Featured {
  const [state, setState] = useState<Featured>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const day = new Date().toDateString();
    if (!daily || daily.day !== day) daily = { day, load: loadFeatured() };
    const load = daily.load;
    load.then(tracks => { if (live) setState(tracks.length ? { status: 'ready', tracks } : { status: 'empty' }); },
      () => { if (daily?.load === load) daily = undefined; if (live) setState({ status: 'empty' }); });
    return () => { live = false; };
  }, []);
  return state;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const TILES = 5;
const WALL = 16;
const COPY_WIDTH = 460;
const GAP = 14;

export function HomeFeatured({ featured, onPlay }: { featured: Featured; onPlay: Play }) {
  const theme = useAppearance();
  const player = usePlayback();
  const [width, setWidth] = useState(0);
  if (featured.status === 'empty') return null;
  const tile = width ? Math.floor((width - GAP * (TILES - 1)) / TILES) : 0;
  const card = [cardSurface(theme), styles.card];
  const measure = (event: { nativeEvent: { layout: { width: number } } }) => setWidth(event.nativeEvent.layout.width);
  if (featured.status === 'loading') return <View testID="home-featured" accessibilityRole="progressbar" accessibilityLabel="loading artist of the week" style={card}>
    <View style={styles.head}>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.raised }} />
      <View style={{ flex: 1, gap: 10 }}>
        <View style={{ width: 110, height: 12, borderRadius: 6, backgroundColor: theme.raised }} />
        <View style={{ width: '45%', height: 28, borderRadius: 8, backgroundColor: theme.raised }} />
      </View>
    </View>
    <View onLayout={measure} style={styles.strip}>
      {tile > 0 && Array.from({ length: TILES }, (_, index) => <View key={index} style={{ width: tile, height: tile, borderRadius: 10, backgroundColor: theme.raised }} />)}
    </View>
  </View>;
  const { tracks } = featured;
  const artist = tracks[0].artist;
  const name = artist.profile.display_name || artist.profile.handle;
  const profile = { pathname: '/u/[handle]' as const, params: { handle: artist.profile.handle || artist.did } };
  const art = [...new Set(tracks.map(track => trackArtwork(track)).filter((uri): uri is string => !!uri && uri !== artist.profile.avatar_url))];
  const total = tracks.reduce((sum, track) => sum + (track.metadata.duration_seconds ?? 0), 0);
  const current = tracks.some(track => track.id === player.current?.id);
  const playing = current && player.status.playing;
  const wall = art.length ? Array.from({ length: WALL }, (_, index) => art[index % art.length]) : [];
  const fade = theme.background;
  const copyWidth = width ? Math.min(COPY_WIDTH, Math.max(340, Math.round(width * 0.62))) : COPY_WIDTH;
  const fadeWidth = Math.min(260, Math.max(120, width * 0.22));
  return <View testID="home-featured" onLayout={measure} style={[styles.wallCard, { backgroundColor: theme.surface }]}>
    {wall.length ? <View aria-hidden pointerEvents="none" style={[styles.wall, { left: copyWidth - 40 }]}>
      {wall.map((uri, index) => <Image key={index} source={{ uri }} resizeMode="cover" style={[styles.tile, { backgroundColor: theme.raised }]} />)}
    </View> : artist.profile.avatar_url ? <Image aria-hidden source={{ uri: artist.profile.avatar_url }} blurRadius={60} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: theme.dark ? 0.22 : 0.16 }]} /> : null}
    <Svg aria-hidden pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs><LinearGradient id="featured-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={copyWidth + fadeWidth} y2="0">
        <Stop offset={copyWidth / (copyWidth + fadeWidth)} stopColor={fade} stopOpacity={1} />
        <Stop offset={1} stopColor={fade} stopOpacity={0} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill="url(#featured-fade)" />
    </Svg>
    <View style={[styles.copy, { maxWidth: copyWidth }]}>
      <Link href={profile} asChild><Pressable accessibilityRole="link" accessibilityLabel={`${name}, artist of the week`} style={styles.byline}>
        <Cover uri={artist.profile.avatar_url} size={36} round />
        <Text style={{ color: theme.accent, fontSize: 12.5 * theme.scale, fontWeight: '700', letterSpacing: 0.4 }}>artist of the week</Text>
      </Pressable></Link>
      <Link href={profile} asChild><Pressable accessibilityRole="link" style={styles.name}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => <Text accessibilityRole="header" aria-level={2} numberOfLines={2}
          style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: (copyWidth < 400 ? 34 : 44) * theme.scale, lineHeight: (copyWidth < 400 ? 38 : 48) * theme.scale, fontWeight: '800', letterSpacing: -1.2, textDecorationLine: hovered ? 'underline' : 'none' }}>{name}</Text>}
      </Pressable></Link>
      {artist.profile.bio ? <Text numberOfLines={2} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, lineHeight: 21 * theme.scale }}>{artist.profile.bio}</Text> : null}
      <View style={styles.play}>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? `Pause ${name}` : `Play ${tracks.length === 1 ? '' : 'all '}${tracks.length} by ${name}`}
          onPress={() => current ? player.setPlaying(!player.status.playing) : onPlay(tracks[0], tracks, name)} style={[styles.bigPlay, { backgroundColor: theme.accent }]}>
          {playing ? <PauseGlyph size={22} color={theme.onAccent} /> : <PlayIcon size={22} color={theme.onAccent} fill={theme.onAccent} />}
        </Pressable>
        {tracks.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Shuffle ${name}`} onPress={() => { const order = shuffled(tracks); onPlay(order[0], order, name); }} style={[styles.shuffle, { borderColor: theme.border }]}>
          <Shuffle size={18} color={theme.text} />
        </Pressable>}
        <Text style={{ color: theme.faint, fontSize: 13 * theme.scale, fontVariant: ['tabular-nums'] }}>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}{total ? ` · ${formatDuration(total)}` : ''}</Text>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, overflow: 'hidden', padding: 22, gap: 18 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, rowGap: 14 },
  title: { flex: 1, minWidth: 220, gap: 2 },
  name: { alignSelf: 'flex-start', maxWidth: '100%' },
  actions: { flexDirection: 'row', gap: 8 },
  strip: { flexDirection: 'row', gap: GAP, minHeight: 1 },
  wallCard: { borderRadius: 18, overflow: 'hidden', minHeight: 300, justifyContent: 'center' },
  wall: { position: 'absolute', top: -60, right: -60, width: 4 * 200 + 3 * 6, flexDirection: 'row', flexWrap: 'wrap', gap: 6, transform: [{ rotate: '-4deg' }] },
  tile: { width: 200, height: 150, borderRadius: 8 },
  copy: { paddingHorizontal: 32, paddingVertical: 28, gap: 6 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', minHeight: 44 },
  play: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  bigPlay: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  shuffle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
