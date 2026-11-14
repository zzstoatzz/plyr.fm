import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
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
  const backdrop = artist.profile.avatar_url || trackArtwork(tracks[0]);
  const profile = { pathname: '/u/[handle]' as const, params: { handle: artist.profile.handle || artist.did } };
  return <View testID="home-featured" style={card}>
    {backdrop ? <Image aria-hidden source={{ uri: backdrop }} blurRadius={60} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: theme.dark ? 0.22 : 0.16 }]} /> : null}
    <View style={styles.head}>
      <Link href={profile} asChild><Pressable accessibilityRole="link" accessibilityLabel={`${name}, artist of the week`}>
        <Cover uri={artist.profile.avatar_url} size={88} round />
      </Pressable></Link>
      <View style={styles.title}>
        <Text style={{ color: theme.accent, fontSize: 12.5 * theme.scale, fontWeight: '700', letterSpacing: 0.4 }}>artist of the week</Text>
        <Link href={profile} asChild><Pressable accessibilityRole="link" style={styles.name}>
          <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 30 * theme.scale, fontWeight: '800', letterSpacing: -0.8 }}>{name}</Text>
        </Pressable></Link>
        {artist.profile.handle ? <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13.5 * theme.scale }}>@{artist.profile.handle}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Action primary icon={PlayIcon} label="Play all" onPress={() => onPlay(tracks[0], tracks, name)} />
        {tracks.length > 1 && <Action icon={Shuffle} label="Shuffle" onPress={() => { const order = shuffled(tracks); onPlay(order[0], order, name); }} />}
      </View>
    </View>
    {artist.profile.bio ? <Text numberOfLines={2} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, lineHeight: 21 * theme.scale, maxWidth: 680 }}>{artist.profile.bio}</Text> : null}
    <View onLayout={measure} style={styles.strip}>
      {tile > 0 && tracks.slice(0, TILES).map(track => {
        const current = player.current?.id === track.id;
        const playing = current && player.status.playing;
        return <Pressable key={track.id} accessibilityRole="button" accessibilityLabel={`${playing ? 'Pause' : current ? 'Resume' : 'Play'} ${track.metadata.title}`}
          onPress={() => current ? player.setPlaying(!player.status.playing) : onPlay(track, tracks, name)} style={{ width: tile, gap: 8 }}>
        {({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => <>
          <View>
            <Cover uri={trackArtwork(track) || artist.profile.avatar_url} size={tile} radius={10} />
            {(hovered || pressed || current) && <View pointerEvents="none" style={[styles.badge, { backgroundColor: theme.accent }]}>
              {playing && (hovered || pressed) ? <PauseGlyph size={16} color={theme.onAccent} /> : playing ? <Equalizer size={18} color={theme.onAccent} /> : <PlayIcon size={18} color={theme.onAccent} fill={theme.onAccent} />}
            </View>}
          </View>
          <View style={{ gap: 2 }}>
            <Text numberOfLines={1} style={{ color: current ? theme.accent : theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
            <Text numberOfLines={1} style={{ color: theme.faint, fontSize: 12.5 * theme.scale, fontVariant: ['tabular-nums'] }}>{[formatDuration(track.metadata.duration_seconds), `${compactCount(track.metrics.play_count)} ${track.metrics.play_count === 1 ? 'play' : 'plays'}`].filter(Boolean).join(' · ')}</Text>
          </View>
        </>}
      </Pressable>;
      })}
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
  badge: { position: 'absolute', right: 8, bottom: 8, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
