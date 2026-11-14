import { trackArtwork } from './artwork';
import { DotsThree as Ellipsis } from './icons';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { artistName, Cover, trackMeta, type Play } from './CatalogPieces';
import { cardSurface } from './materials';
import { Text } from './Text';
import { TrackMenu } from './TrackMenu';
import type { Anchor } from './Sheet';
import { PlayerControl } from './PlayerControl';

export function HomeTrackRow({ track, tracks, onPlay, returnTo = '/', height }: { height?: number; track: Track; tracks: Track[]; onPlay: Play; returnTo?: string }) {
  const theme = useAppearance();
  return <View testID="home-track-row" style={{ height, paddingBottom: 8 }}><View style={[styles.row, cardSurface(theme)]}>
    <Pressable testID="track-play-control" accessibilityRole="button" accessibilityLabel={`Play ${track.metadata.title}`} onPress={() => onPlay(track, tracks)}
      style={({ pressed }) => [StyleSheet.absoluteFill, { borderRadius: 8, backgroundColor: pressed ? theme.hover : 'transparent' }]} />
    <View pointerEvents="none"><Cover uri={trackArtwork(track)} size={44} /></View>
    <View pointerEvents="box-none" style={styles.meta}>
      <Link href={`/track/${track.id}`} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Track details: ${track.metadata.title}`} style={styles.link}><Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text></Pressable></Link>
      <Link href={`/u/${encodeURIComponent(track.artist.profile.handle || track.artist.did)}`} asChild><Pressable accessibilityRole="link" style={styles.link}><Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{artistName(track)}</Text></Pressable></Link>
      <View pointerEvents="none"><Text numberOfLines={1} style={{ color: theme.faint, fontSize: 12 * theme.scale }}>{trackMeta(track)}</Text></View>
    </View>
    <HomeTrackActions track={track} returnTo={returnTo} />
  </View></View>;
}

export function HomeTrackActions({ track, returnTo = '/' }: { track: Track; returnTo?: string }) {
  const [menu, setMenu] = useState<Anchor>();
  const button = useRef<ViewInstance>(null);
  const open = () => {
    const fallback = { x: 0, y: 0, width: 0, height: 0 };
    if (!button.current) return setMenu(fallback);
    button.current.measureInWindow((x, y, width, height) => setMenu({ x, y, width, height }));
  };
  return <View ref={button} style={styles.actions}>
    <PlayerControl icon={Ellipsis} label={`More options for ${track.metadata.title}`} onPress={open} />
    {menu && <TrackMenu track={track} returnTo={returnTo} anchor={menu.width ? menu : undefined} close={() => setMenu(undefined)} />}
  </View>;
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  meta: { flex: 1, minWidth: 0 },
  link: { minHeight: 24, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  actions: { flexDirection: 'row', alignItems: 'center' }
});
