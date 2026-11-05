import { Text } from './Text';
import { Link } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';
import { Cover, Detail, artistName } from './CatalogPieces';

export function TrackPresentation({ track, controls, stats, utilities }: {
  track: Track; controls: ReactNode; stats: ReactNode; utilities: ReactNode;
}) {
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const compact = width < 600;
  const artwork = Math.max(112, Math.min(compact ? width * 0.54 : 300, height * 0.32));
  return <View style={styles.page}>
    <Cover uri={track.media.artwork?.url} size={artwork} radius={12} />
    <View style={styles.identity}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontFamily: theme.fontFamily,
        textAlign: 'center', fontWeight: '800', fontSize: (compact ? 28 : 32) * theme.scale,
        lineHeight: (compact ? 34 : 39) * theme.scale, letterSpacing: -0.5 }}>{track.metadata.title}</Text>
      <Link href={{ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } }}
        style={{ minHeight: 44, maxWidth: '100%', textAlign: 'center', paddingVertical: 11, color: theme.muted, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale }}>
        {artistName(track)}
      </Link>
      {track.metadata.album && <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale, textAlign: 'center' }}>{track.metadata.album}</Text>}
    </View>
    <View style={styles.controls}>{controls}</View>
    <View style={styles.stats}>{stats}</View>
    <View style={styles.utilities}>{utilities}</View>
    {track.metadata.description && <View style={styles.description}><Detail>{track.metadata.description}</Detail></View>}
  </View>;
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 640, alignSelf: 'center', alignItems: 'center', paddingTop: 16, paddingBottom: 20, gap: 18 },
  identity: { width: '100%', alignItems: 'center', gap: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 320 },
  stats: { minHeight: 22, alignItems: 'center', marginTop: -8 },
  utilities: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  description: { alignSelf: 'stretch', marginTop: 8 }
});
