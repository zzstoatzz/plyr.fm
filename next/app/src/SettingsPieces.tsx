import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import type Palette from 'lucide-react-native/icons/palette';
import { Text } from './Text';
import { useAppearance } from './appearance';

export function SettingsSection({ title, icon: Icon, children }: { title: string; icon: typeof Palette; children: ReactNode }) {
  const theme = useAppearance();
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
      <Icon size={18} color={theme.muted} />
      <Text accessibilityRole="header" aria-level={2} style={{ color: theme.muted, fontSize: 14 * theme.scale, fontWeight: '600' }}>{title}</Text>
    </View>
    <View style={{ borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.surface, overflow: 'hidden' }}>{children}</View>
  </View>;
}

export function SettingsRow({ label, value, detail, onPress, children, destructive }: {
  label: string; value?: string; detail?: string; onPress?: () => void; children?: ReactNode; destructive?: boolean;
}) {
  const theme = useAppearance();
  const content = <>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text style={{ color: destructive ? theme.danger : theme.text, fontSize: 15 * theme.scale }}>{label}</Text>
      {detail && <Text style={{ color: theme.muted, fontSize: 12 * theme.scale, lineHeight: 18 * theme.scale }}>{detail}</Text>}
    </View>
    {value && <Text numberOfLines={2} style={{ maxWidth: '44%', color: theme.muted, fontSize: 14 * theme.scale, textAlign: 'right' }}>{value}</Text>}
    {children}
    {onPress && !destructive && <ChevronRight size={18} color={theme.muted} />}
  </>;
  const style = { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.surface };
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}: ${value}` : label} onPress={onPress}
    style={({ pressed }) => [style, { backgroundColor: pressed ? theme.surface : theme.background }]}>{content}</Pressable> : <View style={[style, { backgroundColor: theme.background }]}>{content}</View>;
}
