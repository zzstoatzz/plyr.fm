import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Cover, Heading } from './CatalogPieces';

export function DetailHeader({ title, artwork, round, children, actions }: {
  title: string; artwork?: string | null; round?: boolean; children: ReactNode; actions?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const stacked = width < 520 && !round;
  const size = round ? 88 : stacked ? Math.min(160, width - 40) : 200;
  return <View style={styles.header}>
    <View style={{ gap: 16, flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center' }}>
      <View style={{ alignSelf: stacked ? 'center' : undefined }}><Cover uri={artwork} size={size} round={round} /></View>
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 6, alignItems: stacked ? 'center' : undefined }}>
        <Heading main center={stacked}>{title}</Heading>
        {children}
      </View>
    </View>
    {actions && <View style={[styles.actions, { justifyContent: stacked ? 'center' : 'flex-start' }]}>{actions}</View>}
  </View>;
}

const styles = StyleSheet.create({
  header: { gap: 16, paddingVertical: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' },
});
