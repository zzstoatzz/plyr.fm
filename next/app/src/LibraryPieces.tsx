import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ListSummary, Track } from '@plyr/next-core/api';
import { collectionArtwork, trackArtwork } from '@plyr/next-core/artwork';
import { catalogDuration } from '@plyr/next-core/catalog/owned';
import { tracksContext } from '@plyr/next-core/play-context';
import { useAppearance } from './appearance';
import { Cover, trackCount, type Play } from './CatalogPieces';
import { shuffled } from './HeroPieces';
import { Heart, Pause, Play as PlayIcon, Plus, Shuffle, UploadSimple } from './icons';
import { usePlayContext } from './playback-context';
import { Text } from './Text';

const TILE = 72;

function Mosaic({ tracks, liked }: { tracks: Track[]; liked: boolean }) {
  const theme = useAppearance();
  const covers = [...new Set(tracks.flatMap(track => trackArtwork(track) ?? []))].slice(0, 4);
  const half = TILE / 2;
  return <View aria-hidden style={[styles.mosaic, { backgroundColor: theme.raised }]}>
    {covers.length === 4
      ? <View style={styles.quad}>{covers.map(uri => <Cover key={uri} uri={uri} size={half} radius={0} />)}</View>
      : covers[0] ? <Cover uri={covers[0]} size={TILE} radius={0} /> : null}
    {liked && covers.length ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} /> : null}
    {liked || !covers.length ? <View style={[StyleSheet.absoluteFill, styles.center]}>
      {liked ? <Heart size={28} weight="fill" color={theme.accent} /> : <UploadSimple size={26} color={theme.faint} />}
    </View> : null}
  </View>;
}

/** Liked tracks or your uploads, collapsed to one tile: open it for the list, or play and shuffle from here. */
export function PinnedCollection({ title, href, tracks, failed, liked = false, onPlay }: {
  title: string; href: Href; tracks: Track[] | undefined; failed?: boolean; liked?: boolean; onPlay: Play;
}) {
  const theme = useAppearance();
  const list = tracks ?? [];
  const { pause, press } = usePlayContext(tracksContext(list));
  const seconds = list.reduce((total, track) => total + (track.metadata.duration_seconds ?? 0), 0);
  const summary = failed ? 'could not load' : !tracks ? 'loading…' : !list.length ? 'nothing yet'
    : `${trackCount(list.length)}${seconds ? ' · ' + catalogDuration(seconds) : ''}`;
  const Glyph = pause ? Pause : PlayIcon;
  return <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.line }]}>
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`open ${title}`} style={styles.open}>
        <Mosaic tracks={list} liked={liked} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 18 * theme.scale, fontWeight: '700' }}>{title}</Text>
          <Text numberOfLines={2} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>{summary}</Text>
        </View>
      </Pressable>
    </Link>
    <Pressable accessibilityRole="button" accessibilityLabel={`${pause ? 'Pause' : 'Play'} ${title}`} disabled={!list.length}
      onPress={() => press(() => onPlay(list[0], list, title))}
      style={({ pressed }) => [styles.round, { backgroundColor: theme.accent, opacity: !list.length ? 0.45 : pressed ? 0.8 : 1 }]}>
      <Glyph size={20} weight="fill" color={theme.onAccent} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Shuffle ${title}`} disabled={list.length < 2}
      onPress={() => { const order = shuffled(list); onPlay(order[0], order, title); }}
      style={({ pressed }) => [styles.round, { backgroundColor: theme.raised, opacity: list.length < 2 ? 0.45 : pressed ? 0.8 : 1 }]}>
      <Shuffle size={20} color={theme.text} />
    </Pressable>
  </View>;
}

function PlaylistCard({ list, width }: { list: ListSummary; width: number }) {
  const theme = useAppearance();
  const name = list.metadata.name || 'untitled playlist';
  return <Link href={{ pathname: '/playlist/[id]', params: { id: list.id } }} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={name} style={StyleSheet.flatten([styles.card, { width }])}>
      <Cover uri={collectionArtwork(list)} size={width} radius={10} />
      <Text numberOfLines={1} style={{ marginTop: 6, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, fontWeight: '600' }}>{name}</Text>
      <Text numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale }}>{trackCount(list.metrics.member_count)}</Text>
    </Pressable>
  </Link>;
}

/** Your playlists as a cover grid, led by a card that starts a new one. */
export function PlaylistGrid({ lists, onNew, newDisabled }: { lists: ListSummary[]; onNew: () => void; newDisabled: boolean }) {
  const theme = useAppearance();
  const { width: window } = useWindowDimensions();
  const room = Math.min(window, 1100) - 40;
  const columns = Math.max(2, Math.floor((room + 14) / (176 + 14)));
  const width = Math.floor((room - 14 * (columns - 1)) / columns);
  return <View style={styles.grid}>
    <Pressable accessibilityRole="button" accessibilityLabel="new playlist" disabled={newDisabled} onPress={onNew}
      style={({ pressed }) => [{ width, opacity: newDisabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <View style={[styles.plus, { width, height: width, borderColor: theme.line }]}><Plus size={34} color={theme.faint} /></View>
      <Text numberOfLines={1} style={{ marginTop: 6, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14.5 * theme.scale, fontWeight: '600' }}>new playlist</Text>
    </Pressable>
    {lists.map(list => <PlaylistCard key={list.record.uri} list={list} width={width} />)}
  </View>;
}

const styles = StyleSheet.create({
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  mosaic: { width: TILE, height: TILE, borderRadius: 9, overflow: 'hidden' },
  quad: { flexDirection: 'row', flexWrap: 'wrap', width: TILE },
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, rowGap: 18 },
  card: { gap: 2 },
  plus: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
