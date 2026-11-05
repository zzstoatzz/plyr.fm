import { Text } from './Text';
import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Music2 from 'lucide-react-native/icons/eighth-note';
import PlayIcon from 'lucide-react-native/icons/play';
import UserRound from 'lucide-react-native/icons/user-round';
import type { ListSummary, Page, Track } from './api';
import { Action } from './controls';
import { WaveLoading } from './WaveLoading';
import { useAppearance } from './appearance';

export type Play = (track: Track, queue?: Track[]) => void;
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
  const fetchPage = useCallback(async (next?: string) => {
    if (busy.current) return;
    busy.current = true;
    const request = generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const page = await load(next);
      if (request !== generation.current) return;
      if (page.has_more && (!page.next_cursor || page.next_cursor === next)) throw new Error('could not load more items');
      setData((previous) => next ? [...previous, ...page.data] : page.data);
      setCursor(page.has_more ? page.next_cursor ?? undefined : undefined);
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
  const more = useCallback(() => void fetchPage(cursor), [fetchPage, cursor]);
  return { data, cursor, error, loading, reload, more };
}

export function Heading({ children, main = false }: { children: ReactNode; main?: boolean }) {
  const colors = useColors();
  return <Text accessibilityRole="header" aria-level={main ? 1 : 2} style={[main ? styles.title : styles.heading, { color: colors.text, fontFamily: colors.fontFamily, fontSize: (main ? 28 : 20) * colors.scale }]}>{children}</Text>;
}

export function Detail({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={{ color: colors.muted, fontFamily: colors.fontFamily, fontSize: 15 * colors.scale, lineHeight: 22 * colors.scale }}>{children}</Text>;
}

export function Button(props: Parameters<typeof Action>[0]) {
  return <Action {...props} />;
}

export function Cover({ uri, size = 48, round = false, radius = 9 }: { uri?: string | null; size?: number; round?: boolean; radius?: number }) {
  const colors = useColors();
  const [failedUri, setFailedUri] = useState<string>();
  const style = { width: size, height: size, borderRadius: round ? size / 2 : radius, backgroundColor: colors.surface };
  return uri && uri !== failedUri && /^https?:\/\//i.test(uri) ? <Image accessibilityIgnoresInvertColors source={{ uri }} style={style} onError={() => setFailedUri(uri)} /> : <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
    {round ? <UserRound size={size * 0.38} color={colors.muted} /> : <Music2 size={size * 0.32} color={colors.muted} />}
  </View>;
}

export function Row({
  title, subtitle, image, href, action, round = false, onNavigate,
}: {
  title: string; subtitle?: string | null; image?: string | null; href: Href; action?: ReactNode; round?: boolean; onNavigate?: () => void;
}) {
  const colors = useColors();
  return <View style={[styles.row, { borderColor: colors.surface }]}>
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" onPress={onNavigate} style={styles.rowLink}>
        <Cover uri={image} round={round} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text, fontFamily: colors.fontFamily, fontSize: 16 * colors.scale }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: colors.fontFamily, fontSize: 14 * colors.scale }}>{subtitle}</Text> : null}
        </View>
      </Pressable>
    </Link>
    {action}
  </View>;
}

export function artistName(track: Track) {
  return track.metadata.artist_name || track.artist.profile.display_name || track.artist.profile.handle;
}

export function TrackRows({ tracks, onPlay }: { tracks: Track[]; onPlay: Play }) {
  return tracks.map((track, index) => <Row
    key={`${track.id}:${index}`}
    href={{ pathname: '/track/[id]', params: { id: track.id } }}
    title={track.metadata.title}
    subtitle={artistName(track)}
    image={track.media.artwork?.url}
    action={<RowPlay onPress={() => onPlay(track, tracks)} />}
  />);
}

export function RowPlay({ onPress, label = 'Play', busy = false }: { onPress: () => void; label?: string; busy?: boolean }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} disabled={busy} onPress={onPress}
    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
    {busy ? <ActivityIndicator accessibilityLabel="Loading playback" color={colors.muted} /> : <PlayIcon size={20} color={colors.text} fill={colors.text} />}
  </Pressable>;
}

export function ListRows({ lists }: { lists: ListSummary[] }) {
  return lists.map((list) => <Row
    key={list.id}
    href={{
      pathname: list.object === 'album' ? '/album/[id]' : '/playlist/[id]',
      params: { id: list.id },
    }}
    title={list.metadata.name ?? 'Untitled'}
    subtitle={`${list.metrics.member_count} tracks`}
    image={list.media?.artwork?.url}
  />);
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
  heading: { fontWeight: '700', marginTop: 5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontWeight: '600' },
});
