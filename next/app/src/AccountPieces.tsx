import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { Text } from './Text';
import { useAppearance } from './appearance';

export function AccountSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppearance();
  return <View style={[styles.section, { borderColor: theme.hairline }]}>
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

export function Choice({ label, selected, onPress, role = 'button', ref, nativeID, 'aria-controls': controls }: { label: string; selected: boolean; onPress: () => void; role?: 'button' | 'tab'; ref?: Ref<ViewInstance>; nativeID?: string; 'aria-controls'?: string }) {
  const theme = useAppearance();
  return <Pressable ref={ref} nativeID={nativeID} aria-controls={controls} accessibilityRole={role} tabIndex={role === 'tab' && !selected ? -1 : 0} accessibilityLabel={label} accessibilityState={{ selected }} aria-pressed={role === 'button' ? selected : undefined} aria-selected={role === 'tab' ? selected : undefined} onPress={onPress}
    style={({ pressed }) => role === 'tab'
      ? { minHeight: 44, paddingHorizontal: 4, marginRight: 16, justifyContent: 'center', borderBottomWidth: 2, borderColor: selected ? theme.accent : 'transparent', opacity: pressed ? 0.7 : 1 }
      : { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected || pressed ? theme.surface : 'transparent', justifyContent: 'center' }}>
    <Text style={{ color: selected ? theme.text : theme.muted, fontFamily: theme.fontFamily, fontSize: (role === 'tab' ? 16 : 14) * theme.scale, fontWeight: selected ? '700' : '500', textTransform: 'lowercase' }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 16, paddingVertical: 8, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth }
});
