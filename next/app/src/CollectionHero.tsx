import { Link } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ListDetail, Track } from '@plyr/next-core/api';
import { collectionArtwork, trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { BLEED, Chip, HeroBackdrop, Pill, Round, TOP, shuffled } from './HeroPieces';
import { Cover } from './CatalogPieces';
import { catalogRuntime } from '@plyr/next-core/catalog/runtime';
import { compactCount } from './home-state';
import { ListPlus, Pause as PauseIcon, Play as PlayIcon, ShareNetwork, Shuffle } from './icons';
import { Text } from './Text';

const COVER = 208;

/** A playlist without its own cover shows its first four distinct covers as a 2×2 grid. */
function collage(list: ListDetail, tracks: Track[]) {
  if (list.object !== 'playlist' || list.metadata.cover_blob_cid) return null;
  const covers = [...new Set(tracks.flatMap(track => trackArtwork(track) ?? []))];
  return covers.length >= 4 ? covers.slice(0, 4) : null;
}

export function CollectionHero({ list, tracks, title, playing, onPlay, onPause, onEnqueue, onShare }: {
  list: ListDetail; tracks: Track[]; title: string; playing: boolean;
  onPlay: (track: Track, queue: Track[]) => void; onPause: () => void; onEnqueue: () => void; onShare: () => void;
}) {
  const theme = useAppearance();
  const { width, fontScale } = useWindowDimensions();
  const icon = (size: number) => Math.round(size * Math.min(fontScale * theme.scale, 1.6));
  const size = Math.min(COVER, width - 2 * BLEED - 80);
  const artwork = collectionArtwork(list);
  const grid = collage(list, tracks);
  const owner = list.owner.profile;
  const ownerName = owner ? owner.display_name || owner.handle : null;
  const seconds = tracks.reduce((total, track) => total + (track.metadata.duration_seconds ?? 0), 0);
  const plays = list.metrics.total_plays;
  const year = list.object === 'album' ? new Date(list.metadata.created_at).getFullYear() : NaN;
  const backdrop = Math.round(TOP + 24 + size * 1.55);
  return <View style={{ marginHorizontal: -BLEED, marginTop: -TOP, paddingHorizontal: BLEED, paddingTop: TOP + 24 }}>
    {artwork || grid ? <HeroBackdrop uri={(artwork ?? grid![0])} height={backdrop} /> : null}

    <View style={styles.identity}>
      {grid
        ? <View style={{ borderRadius: 12, boxShadow: theme.dark ? '0px 12px 32px #0000008c' : '0px 12px 32px #00000038' }}>
          <View style={[styles.collage, { width: size, height: size }]}>
            {grid.map(uri => <Cover key={uri} uri={uri} size={size / 2} radius={0} />)}
          </View>
        </View>
        : <Cover uri={artwork} size={size} radius={12} />}
      <Text accessibilityRole="header" aria-level={1} numberOfLines={3} style={{ marginTop: 18, color: theme.text, fontFamily: theme.fontFamily,
        fontSize: 26 * theme.scale, lineHeight: 31 * theme.scale, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' }}>{title}</Text>
      {owner && ownerName ? <Link href={{ pathname: '/u/[handle]', params: { handle: owner.handle || list.owner.did } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={ownerName} hitSlop={8} style={styles.owner}>
          <Cover uri={owner.avatar_url} size={22} round />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale, fontWeight: '600' }}>{ownerName}</Text>
        </Pressable>
      </Link> : null}
    </View>

    <View style={styles.chips} accessibilityRole="summary">
      <Chip value={tracks.length.toLocaleString()} label={tracks.length === 1 ? 'track' : 'tracks'} />
      {seconds > 0 ? <Chip value={catalogRuntime(seconds)} /> : null}
      {plays > 0 ? <Chip value={compactCount(plays)} label={plays === 1 ? 'play' : 'plays'} /> : null}
      {Number.isFinite(year) ? <Chip value={String(year)} /> : null}
    </View>

    {tracks.length ? <View style={styles.controls}>
      <Pill primary icon={playing ? <PauseIcon size={icon(18)} color={theme.onAccent} fill={theme.onAccent} /> : <PlayIcon size={icon(18)} color={theme.onAccent} fill={theme.onAccent} />}
        label={playing ? 'Pause' : 'Play'} accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${title}`}
        onPress={() => playing ? onPause() : onPlay(tracks[0], tracks)} />
      <Pill icon={<ListPlus size={icon(19)} color={theme.text} />} label="Queue" accessibilityLabel={`Add ${title} to queue`} onPress={onEnqueue} />
      {tracks.length > 1 ? <Round label={`Shuffle ${title}`} onPress={() => { const order = shuffled(tracks); onPlay(order[0], order); }}>
        <Shuffle size={icon(20)} color={theme.text} />
      </Round> : null}
      <Round label={`Share ${title}`} onPress={onShare}><ShareNetwork size={icon(20)} color={theme.text} /></Round>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: 2 },
  collage: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, overflow: 'hidden' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, minHeight: 32, maxWidth: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
});
