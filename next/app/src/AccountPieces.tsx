import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { Text } from './Text';
import { useAppearance } from './appearance';

export function AccountSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppearance();
  return <View style={[styles.section, { borderColor: theme.surface }]}>
    <Text accessibilityRole="header" aria-level={2} style={{ color: theme.text, fontSize: 18 * theme.scale, fontWeight: '700' }}>{title}</Text>
    <View style={{ gap: 14 }}>{children}</View>
  </View>;
}

export function Setting({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  const theme = useAppearance();
  return <View style={{ gap: 8 }}>
    <View style={{ gap: 3 }}>
      <Text style={{ color: theme.text, fontSize: 15 * theme.scale }}>{label}</Text>
      {detail && <Text style={{ color: theme.muted, fontSize: 13 * theme.scale, lineHeight: 19 * theme.scale }}>{detail}</Text>}
    </View>
    {children}
  </View>;
}

export function Choice({ label, selected, onPress, role = 'button', ref }: { label: string; selected: boolean; onPress: () => void; role?: 'button' | 'tab'; ref?: Ref<ViewInstance> }) {
  const theme = useAppearance();
  return <Pressable ref={ref} accessibilityRole={role} tabIndex={role === 'tab' && !selected ? -1 : 0} accessibilityLabel={label} accessibilityState={{ selected }} aria-pressed={role === 'button' ? selected : undefined} aria-selected={role === 'tab' ? selected : undefined} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
      borderWidth: 1, borderColor: selected ? theme.accent : theme.surface, backgroundColor: selected || pressed ? theme.surface : 'transparent', justifyContent: 'center' })}>
    <Text style={{ color: selected ? theme.text : theme.muted, fontSize: 14 * theme.scale, fontWeight: selected ? '700' : '400' }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 16, paddingVertical: 8, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth }
});
