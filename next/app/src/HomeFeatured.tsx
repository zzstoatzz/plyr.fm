import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, type Track } from './api';
import { useAppearance } from './appearance';
import { trackArtwork } from './artwork';
import { Cover, type Play } from './CatalogPieces';
import { Action } from './controls';
import { formatDuration, rankedArtists, weekNumber } from './home-state';
import { Play as PlayIcon, Shuffle, Sparkle } from './icons';
import { cardSurface } from './materials';
import { Text } from './Text';

type Featured = { status: 'loading' } | { status: 'empty' } | { status: 'ready'; tracks: Track[] };

let daily: { day: string; load: Promise<Track[]> } | undefined;

async function loadFeatured(): Promise<Track[]> {
  const liked = (await api.chart('all_time')).data.map(({ track }) => track);
  const ranked = rankedArtists(liked);
  if (!ranked.length) return [];
  const start = weekNumber() % ranked.length;
  let fallback: Track[] = [];
  // a week is better spent on an artist with a few tracks to sit with; try the next ones in turn
  for (let step = 0; step < Math.min(4, ranked.length); step++) {
    const did = ranked[(start + step) % ranked.length];
    const tracks = (await api.tracks({ artist_did: did, limit: 8 })).data;
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

export function HomeFeatured({ featured, onPlay, art = 216 }: { featured: Featured; onPlay: Play; art?: number }) {
  const theme = useAppearance();
  if (featured.status === 'empty') return null;
  const surface = [cardSurface(theme), styles.card, { borderRadius: 18 }];
  if (featured.status === 'loading') return <View testID="home-featured" accessibilityRole="progressbar" accessibilityLabel="loading artist of the week" style={surface}>
    <View style={{ width: art, height: art, borderRadius: 12, backgroundColor: theme.raised }} />
    <View style={[styles.body, { gap: 14 }]}>
      <View style={{ width: 120, height: 12, borderRadius: 6, backgroundColor: theme.raised }} />
      <View style={{ width: '50%', height: 30, borderRadius: 8, backgroundColor: theme.raised }} />
      <View style={{ width: '70%', height: 12, borderRadius: 6, backgroundColor: theme.raised }} />
    </View>
  </View>;
  const { tracks } = featured;
  const artist = tracks[0].artist;
  const name = artist.profile.display_name || artist.profile.handle;
  const profile = { pathname: '/u/[handle]' as const, params: { handle: artist.profile.handle || artist.did } };
  return <View testID="home-featured" style={surface}>
    <Link href={profile} asChild><Pressable accessibilityRole="link" accessibilityLabel={`${name}, artist of the week`}>
      <Cover uri={trackArtwork(tracks[0]) || artist.profile.avatar_url} size={art} radius={12} />
    </Pressable></Link>
    <View style={styles.body}>
      <View style={styles.eyebrow}>
        <Sparkle size={13} color={theme.accent} weight="fill" />
        <Text style={{ color: theme.accent, fontSize: 12.5 * theme.scale, fontWeight: '700', letterSpacing: 0.3 }}>artist of the week</Text>
      </View>
      <Link href={profile} asChild><Pressable accessibilityRole="link" style={styles.name}>
        <Cover uri={artist.profile.avatar_url} size={36} round />
        <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 32 * theme.scale, fontWeight: '800', letterSpacing: -1 }}>{name}</Text>
      </Pressable></Link>
      {artist.profile.bio ? <Text numberOfLines={2} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, lineHeight: 21 * theme.scale, maxWidth: 560 }}>{artist.profile.bio}</Text> : null}
      <View style={styles.actions}>
        <Action primary icon={PlayIcon} label="Play all" onPress={() => onPlay(tracks[0], tracks, name)} />
        {tracks.length > 1 && <Action icon={Shuffle} label="Shuffle" onPress={() => { const order = shuffled(tracks); onPlay(order[0], order, name); }} />}
      </View>
      <View style={styles.list}>
        {tracks.slice(0, 6).map((track, index) => <Pressable key={track.id} accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks, name)}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, { borderTopColor: theme.hairline, backgroundColor: pressed || hovered ? theme.hover : 'transparent' }]}>
          <Text style={{ width: 16, textAlign: 'right', color: theme.faint, fontSize: 12 * theme.scale, fontVariant: ['tabular-nums'] }}>{index + 1}</Text>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale }}>{track.metadata.title}</Text>
          <Text style={{ color: theme.faint, fontSize: 12 * theme.scale, fontVariant: ['tabular-nums'] }}>{formatDuration(track.metadata.duration_seconds)}</Text>
        </Pressable>)}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 26, padding: 20, alignItems: 'flex-start' },
  body: { flex: 1, minWidth: 0, gap: 10 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'flex-start', maxWidth: '100%' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  list: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, marginTop: 4 },
  item: { flexBasis: '45%', flexGrow: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, borderTopWidth: 1, borderRadius: 4, paddingHorizontal: 4 },
});
