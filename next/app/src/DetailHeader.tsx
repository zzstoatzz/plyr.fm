import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Cover, Heading } from './CatalogPieces';

export function DetailHeader({ title, artwork, round, children }: {
  title: string; artwork?: string | null; round?: boolean; children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const stacked = width < 520 && !!artwork && !round;
  const size = round ? 88 : stacked ? Math.min(184, width - 40) : artwork ? 148 : 88;
  return <View style={{
    gap: 16, paddingVertical: 8, flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center'
  }}>
    <View style={{ alignSelf: stacked ? 'center' : undefined }}>
      <Cover uri={artwork} size={size} round={round} radius={14} />
    </View>
    <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 6 }}>
      <Heading main>{title}</Heading>
      {children}
    </View>
  </View>;
}
