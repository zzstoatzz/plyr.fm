import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Cover, Heading, useColors } from './CatalogPieces';
import { Text } from './Text';

export function DetailHeader({ title, kind, artwork, round, children }: {
  title: string; kind?: string; artwork?: string | null; round?: boolean; children: ReactNode;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const stacked = width < 520 && !!artwork && !round;
  const size = round ? 88 : stacked ? Math.min(184, width - 40) : artwork ? 200 : 88;
  return <View style={{
    gap: 16, paddingVertical: 8, flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : round ? 'center' : 'flex-end'
  }}>
    <View style={{ alignSelf: stacked ? 'center' : undefined }}>
      <Cover uri={artwork} size={size} round={round} />
    </View>
    <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 6, alignItems: stacked ? 'center' : undefined }}>
      {kind && <Text style={{ color: colors.faint, fontSize: 12 * colors.scale, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' }}>{kind}</Text>}
      <Heading main center={stacked}>{title}</Heading>
      {children}
    </View>
  </View>;
}
