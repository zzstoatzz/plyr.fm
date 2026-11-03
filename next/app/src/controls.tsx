import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useAppearance } from './appearance';

export function Action({ label, onPress, href, disabled, selected, primary }: {
  label: string; onPress?: () => void; href?: Href; disabled?: boolean; selected?: boolean; primary?: boolean;
}) {
  const theme = useAppearance();
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={{ ...styles.button, backgroundColor: primary ? theme.text : theme.surface, opacity: disabled ? 0.5 : 1,
      borderColor: selected ? theme.accent : 'transparent' }}>
    <Text style={{ color: primary ? theme.background : theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>{label}</Text>
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppearance();
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28 * theme.scale, fontFamily: theme.fontFamily, fontWeight: '700' }}>{title}</Text>
    {children}
  </ScrollView>;
}

export function Copy({ children }: { children: ReactNode }) {
  const theme = useAppearance();
  return <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale }}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useAppearance();
  return <View style={{ gap: 6 }}>
    <Copy>{label}</Copy>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={theme.muted}
      style={[styles.input, { color: theme.text, backgroundColor: theme.surface, fontFamily: theme.fontFamily, fontSize: 16 * theme.scale }]} />
  </View>;
}

export const pageFrame = { width: '100%', maxWidth: 824, alignSelf: 'center', paddingHorizontal: 20 } as const;

export const row = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } as const;
const styles = StyleSheet.create({
  page: { ...pageFrame, gap: 16, paddingTop: 16, paddingBottom: 32 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  input: { minHeight: 48, padding: 12, borderRadius: 8 }
});
