import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Cover, Heading } from './CatalogPieces';
import { useAppearance } from './appearance';

export function DetailHeader({ title, artwork, round, children }: {
  title: string; artwork?: string | null; round?: boolean; children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const theme = useAppearance();
  const compact = width < 520;
  return <View style={{
    backgroundColor: theme.surface, borderRadius: 20, padding: 20, gap: 18,
    flexDirection: compact ? 'column' : 'row', alignItems: compact && !round ? 'center' : 'flex-start'
  }}>
    <Cover uri={artwork} size={round ? 96 : compact ? Math.min(220, width - 90) : 160} round={round} />
    <View style={{ width: compact ? '100%' : undefined, flex: compact ? undefined : 1, gap: 8 }}>
      <Heading main>{title}</Heading>
      {children}
    </View>
  </View>;
}
