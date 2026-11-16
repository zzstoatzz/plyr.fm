import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAppearance } from './appearance';
import { Text } from './Text';

export function catalogRuntime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

export function CatalogMetrics({ metrics, lead }: {
  metrics: readonly { label: string; value: string }[];
  lead?: { label: string; value: string };
}) {
  const theme = useAppearance();
  const { width, fontScale } = useWindowDimensions();
  const stack = width < 350 || theme.scale * fontScale > 1.15;
  const cells = lead ? [lead, ...metrics] : metrics;
  return <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]} accessibilityRole="summary">
    <View style={{ flexDirection: stack ? 'column' : 'row', flexWrap: stack ? 'nowrap' : 'wrap' }}>
      {cells.map((metric, index) => {
        const featured = metric === lead;
        return <View key={metric.label} accessible accessibilityLabel={`${metric.value} ${metric.label}`}
          style={[styles.metric, { backgroundColor: featured ? theme.raised : theme.surface, flexBasis: stack ? 'auto' : featured ? '100%' : 0,
            borderColor: theme.line, borderLeftWidth: !stack && index > (lead ? 1 : 0) ? StyleSheet.hairlineWidth : 0,
            borderTopWidth: (stack && index > 0 || !!lead && !featured) ? StyleSheet.hairlineWidth : 0 }]}>
          <Text style={{ color: featured ? theme.accent : theme.text, fontSize: (featured ? 38 : 21) * theme.scale, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{metric.value}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 * theme.scale }}>{metric.label}</Text>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  group: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  metric: { gap: 3, flexGrow: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 },
});
