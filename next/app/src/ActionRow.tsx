import { Link, type Href } from 'expo-router';
import type { Icon } from './icons';
import { createContext, useContext, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useAppearance } from './appearance';

/** Rows inside a dropdown anchored to its button sit tighter than rows in a sheet. */
export const CompactRows = createContext(false);

export function ActionRow({ label, icon: Icon, onPress, href, disabled }: {
  label: string; icon: Icon; onPress?: () => void; href?: Href; disabled?: boolean;
}) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const compact = useContext(CompactRows);
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={{ minHeight: compact ? 40 : 54, flexDirection: 'row', alignItems: 'center', gap: compact ? 12 : 14, paddingHorizontal: compact ? 12 : 8,
      paddingVertical: compact ? 8 : 12, borderBottomWidth: compact ? 0 : StyleSheet.hairlineWidth, borderColor: theme.hairline, borderRadius: compact ? 8 : 0,
      backgroundColor: compact ? pressed || hovered ? theme.hover : 'transparent' : pressed ? theme.surface : 'transparent', opacity: disabled ? 0.45 : 1 }}>
    <View style={{ width: compact ? 20 : 24, alignItems: 'center' }}><Icon size={compact ? 18 : 21} color={theme.muted} /></View>
    <Text style={{ flex: 1, color: theme.text, fontSize: (compact ? 14.5 : 16) * theme.scale }}>{label}</Text>
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}
