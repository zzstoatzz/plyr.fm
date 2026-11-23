import { router } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AtlasPoint } from '@plyr/next-core/atlas/types';
import { tracksContext } from '@plyr/next-core/play-context';
import { api } from '../api-client';
import { useAppearance } from '../appearance';
import { Cover, useResource } from '../CatalogPieces';
import { Round } from '../HeroPieces';
import { X } from '../icons';
import { canonicalTrackId } from '../legacy-track';
import { glassSurface } from '../materials';
import { PauseGlyph, PlayGlyph } from '../PlayerGlyph';
import { usePlayContext, usePlayback } from '../playback-context';
import { Text } from '../Text';

/** The track a tap picked on the map: play it from here, or open its page. */
export function AtlasSelection({ point, onClose }: { point: AtlasPoint; onClose: () => void }) {
  const theme = useAppearance();
  const player = usePlayback();
  const load = useCallback(async () => api.track(await canonicalTrackId(String(point.id), new AbortController().signal)), [point.id]);
  const track = useResource(load);
  const { pause, press } = usePlayContext(tracksContext(track.data ? [track.data] : []));
  const Glyph = pause ? PauseGlyph : PlayGlyph;
  const detail = track.error ? 'couldn’t find this track on plyr.fm.' : `${point.artist} · ${point.plays.toLocaleString()} ${point.plays === 1 ? 'play' : 'plays'}`;
  return <View style={[styles.card, glassSurface(theme)]}>
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${point.title}`} disabled={!track.data} style={styles.open}
      onPress={() => track.data && router.push({ pathname: '/track/[id]', params: { id: track.data.id } })}>
      <Cover uri={point.thumb} size={44} />
      <View style={styles.words}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '700' }}>{point.title}</Text>
        <Text numberOfLines={1} style={{ color: track.error ? theme.danger : theme.muted, fontSize: 13 * theme.scale }}>{detail}</Text>
      </View>
    </Pressable>
    {!track.error && <Round label={`${pause ? 'Pause' : 'Play'} ${point.title}`}
      onPress={() => track.data && press(() => player.play(track.data!))}>
      <Glyph size={22} color={track.data ? theme.text : theme.faint} />
    </Round>}
    <Pressable accessibilityRole="button" accessibilityLabel="Close track" onPress={onClose} style={styles.close}>
      <X size={18} color={theme.muted} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, padding: 6 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  words: { flex: 1, minWidth: 0, gap: 1 },
  close: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }
});
