import { Link, type Href } from 'expo-router';
import type { Icon } from './icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useAppearance } from './appearance';

export function ActionRow({ label, icon: Icon, onPress, href, disabled }: {
  label: string; icon: Icon; onPress?: () => void; href?: Href; disabled?: boolean;
}) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8,
      paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline,
      backgroundColor: pressed ? theme.surface : 'transparent', opacity: disabled ? 0.45 : 1 }}>
    <View style={{ width: 24, alignItems: 'center' }}><Icon size={21} color={theme.muted} /></View>
    <Text style={{ flex: 1, color: theme.text, fontSize: 16 * theme.scale }}>{label}</Text>
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}
