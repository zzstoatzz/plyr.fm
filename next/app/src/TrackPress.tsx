import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { useLongPressGesture } from 'react-native-gesture-handler';
import { StyleSheet, View, type ViewInstance } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { artistName, Cover, trackMeta } from './CatalogPieces';
import { cardSurface } from './materials';
import { Text } from './Text';
import { TrackMenu } from './TrackMenu';
import type { Anchor } from './Sheet';

/**
 * Long press on any track row: a haptic tick, then the row lifts with its menu beside it.
 * A native recognizer, so a row that re-renders on every playback tick still sees the hold.
 */
export function useTrackPress(track: Track, returnTo?: string) {
  const row = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<Anchor>();
  function open() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const node = row.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => { if (width) setAnchor({ x, y, width, height }); });
  }
  const menu = anchor && <TrackMenu track={track} returnTo={returnTo} close={() => setAnchor(undefined)}
    lift={{ anchor, preview: <TrackPreview track={track} height={anchor.height} /> }} />;
  const hold = useLongPressGesture({ runOnJS: true, minDuration: 350, onActivate: open });
  return { row, hold, menu };
}

function TrackPreview({ track, height }: { track: Track; height: number }) {
  const theme = useAppearance();
  return <View style={[styles.row, cardSurface(theme), { minHeight: height, backgroundColor: theme.raised }]}>
    <Cover uri={trackArtwork(track)} size={Math.min(48, height - 12)} />
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{track.metadata.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{artistName(track)}</Text>
      <Text numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale }}>{trackMeta(track)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
});
