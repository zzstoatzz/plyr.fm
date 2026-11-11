import { trackArtwork, collectionArtwork } from './artwork';
import { Text } from './Text';
import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import Music2 from 'lucide-react-native/icons/eighth-note';
import PlayIcon from 'lucide-react-native/icons/play';
import UserRound from 'lucide-react-native/icons/user-round';
import type { ListSummary, Page, Track } from './api';
import { Action } from './controls';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';
import { artworkShadow, cardSurface } from './materials';

export type Play = (track: Track, queue?: Track[], label?: string) => void;
export type TrackActions = (track: Track) => ReactNode;
type Result<T> = { data?: T; error?: string };
export const useColors = useAppearance;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load the catalog.';
}

export function useResource<T>(load: () => Promise<T>, delay = 0, keepDataOnRetry = false) {
  const [result, setResult] = useState<Result<T>>({});
  const [attempt, setAttempt] = useState(0);
  const previousLoad = useRef(load);
  useEffect(() => {
    let current = true;
    if (!keepDataOnRetry || previousLoad.current !== load) setResult({});
    previousLoad.current = load;
    const timer = setTimeout(() => {
      void load().then(
        (data) => { if (current) setResult({ data }); },
        (error: unknown) => { if (current) setResult({ error: errorMessage(error) }); },
      );
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [load, delay, attempt, keepDataOnRetry]);
  return { ...result, retry: () => setAttempt((value) => value + 1) };
}

export function usePages<T>(load: (cursor?: string) => Promise<Page<T>>) {
  const [data, setData] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const busy = useRef(false);
  const continuation = useRef<string | undefined>(undefined);
  const done = useRef(false);
  const seen = useRef(new Set<string>());
  const fetchPage = useCallback(async (next?: string) => {
    if (busy.current) return;
    busy.current = true;
    const request = generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await load(next);
      if (request !== generation.current) return;
      if (page.has_more && (!page.next_cursor || page.next_cursor === next || seen.current.has(page.next_cursor))) throw new Error('could not load more items');
      if (next) seen.current.add(next);
      continuation.current = page.has_more ? page.next_cursor ?? undefined : undefined;
      done.current = !page.has_more;
      setData((previous) => next ? [...previous, ...page.data] : page.data);
      setCursor(continuation.current);
    } catch (failure) {
      if (request === generation.current) setError(errorMessage(failure));
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [load]);
  const reload = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    continuation.current = undefined;
    done.current = false;
    seen.current.clear();
    setData([]);
    setCursor(undefined);
    void fetchPage();
  }, [fetchPage]);
  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
      busy.current = false;
    };
  }, [reload]);
  const more = useCallback(() => { if (!done.current) void fetchPage(continuation.current); }, [fetchPage]);
  return { data, cursor, error, loading, reload, more };
}

export function Heading({ children, main = false, center = false }: { children: ReactNode; main?: boolean; center?: boolean }) {
  const colors = useColors();
  return <Text accessibilityRole="header" aria-level={main ? 1 : 2} style={[main ? styles.title : styles.heading, { color: colors.text, fontFamily: colors.fontFamily, fontSize: (main ? 28 : 20) * colors.scale,
    textAlign: center ? 'center' : undefined, textShadowColor: colors.dark ? '#00000073' : '#00000014', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }]}>{children}</Text>;
}

export function Detail({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={{ color: colors.muted, fontFamily: colors.fontFamily, fontSize: 15 * colors.scale, lineHeight: 22 * colors.scale }}>{children}</Text>;
}

export function Button(props: Parameters<typeof Action>[0]) {
  return <Action {...props} />;
}

export function Cover({ uri, size = 48, round = false, radius = 8 }: { uri?: string | null; size?: number; round?: boolean; radius?: number }) {
  const colors = useColors();
  const [failedUri, setFailedUri] = useState<string>();
  const opacity = useRef(new Animated.Value(0)).current;
  const borderRadius = round ? size / 2 : radius;
  const style = { width: size, height: size, borderRadius, backgroundColor: colors.raised, ...(size >= 100 && !round ? artworkShadow(colors) : {}) };
  const reveal = () => Animated.timing(opacity, { toValue: 1, duration: colors.reduceMotion ? 0 : 180, useNativeDriver: Platform.OS !== 'web' }).start();
  return uri && uri !== failedUri && /^https?:\/\//i.test(uri) ? <View style={style}>
    <Animated.Image accessibilityIgnoresInvertColors source={{ uri }} style={{ width: size, height: size, borderRadius, opacity }} onLoad={reveal} onError={() => setFailedUri(uri)} />
  </View> : <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
    {round ? <UserRound size={size * 0.38} color={colors.muted} /> : <Music2 size={size * 0.32} color={colors.muted} />}
  </View>;
}

export function Row({
  title, subtitle, meta, image, href, action, round = false, onNavigate,
}: {
  title: string; subtitle?: string | null; meta?: string; image?: string | null; href: Href; action?: ReactNode; round?: boolean; onNavigate?: () => void;
}) {
  const colors = useColors();
  return <View style={[styles.row, cardSurface(colors)]}>
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" onPress={onNavigate} style={styles.rowLink}>
        <Cover uri={image} round={round} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text, fontFamily: colors.fontFamily, fontSize: 16 * colors.scale }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: colors.fontFamily, fontSize: 14 * colors.scale }}>{subtitle}</Text> : null}
          {meta ? <Text numberOfLines={1} style={{ color: colors.faint, fontFamily: colors.fontFamily, fontSize: 12 * colors.scale }}>{meta}</Text> : null}
        </View>
      </Pressable>
    </Link>
    {action}
  </View>;
}

export function artistName(track: Track) {
  return track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle;
}

export function trackMeta(track: Track) {
  const { play_count: plays, like_count: likes } = track.metrics;
  return `${plays} ${plays === 1 ? 'play' : 'plays'}` + (likes > 0 ? ` · ${likes} ${likes === 1 ? 'like' : 'likes'}` : '');
}

export function TrackRows({ tracks, onPlay }: { tracks: Track[]; onPlay: Play }) {
  return <View style={styles.rows}>{tracks.map((track, index) => <Row
    key={`${track.id}:${index}`}
    href={{ pathname: '/track/[id]', params: { id: track.id } }}
    title={track.metadata.title}
    subtitle={artistName(track)}
    meta={trackMeta(track)}
    image={trackArtwork(track)}
    action={<RowPlay onPress={() => onPlay(track, tracks)} />}
  />)}</View>;
}

export function RowPlay({ onPress, label = 'Play', busy = false }: { onPress: () => void; label?: string; busy?: boolean }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} disabled={busy} onPress={onPress}
    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
    {busy ? <ActivityIndicator accessibilityLabel="Loading playback" color={colors.muted} /> : <PlayIcon size={20} color={colors.text} fill={colors.text} />}
  </Pressable>;
}

export function ListRows({ lists }: { lists: ListSummary[] }) {
  return <View style={styles.rows}>{lists.map((list) => <Row
    key={list.id}
    href={{
      pathname: list.object === 'album' ? '/album/[id]' : '/playlist/[id]',
      params: { id: list.id },
    }}
    title={list.metadata.name ?? 'Untitled'}
    subtitle={`${list.metrics.member_count} tracks`}
    image={collectionArtwork(list)}
  />)}</View>;
}

export function Status({ loading, error, retry, empty }: { loading?: boolean; error?: string; retry?: () => void; empty?: string }) {
  if (loading) return <WaveLoading label="Loading catalog" />;
  if (error) return <View accessibilityRole="alert" style={styles.group}>
    <Detail>{error}</Detail>
    {retry ? <Button label="Retry" onPress={retry} /> : null}
  </View>;
  return empty ? <Detail>{empty}</Detail> : null;
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  title: { fontWeight: '800', letterSpacing: -0.8 },
  heading: { fontWeight: '700', marginTop: 5, textTransform: 'lowercase' },
  rows: { gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 12, paddingRight: 4 },
  rowLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontWeight: '600' },
});
