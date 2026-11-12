import { usePressIntent } from './use-press-intent';
import { useRef } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useAppearance } from './appearance';
import { PlayerLoader } from './PlayerLoader';
import type { Glyph } from './PlayerGlyph';

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy, destructive, disabled, glow }: {
  icon: Glyph; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean; destructive?: boolean; disabled?: boolean; glow?: boolean;
}) {
  const theme = useAppearance();
  const press = usePressIntent(onPress);
  const scale = useRef(new Animated.Value(1)).current;
  const native = Platform.OS !== 'web';
  const squeeze = (toValue: number) => {
    if (theme.reduceMotion) return;
    Animated.spring(scale, { toValue, stiffness: toValue < 1 ? 900 : 420, damping: toValue < 1 ? 40 : 16, mass: 1, useNativeDriver: native }).start();
  };
  const fill = primary ? large ? theme.accent : theme.text : undefined;
  const color = destructive ? theme.danger : primary ? large ? theme.onAccent : theme.background : theme.text;
  const size = primary ? large ? 72 : 44 : large ? 56 : 44;
  const disc = primary ? large ? 72 : 36 : size;
  const glyph = primary ? large ? 38 : 20 : large ? 34 : 24;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy || disabled }}
    disabled={busy || disabled} {...press}
    onPressIn={() => { press.onPressIn(); squeeze(primary ? 0.92 : 0.86); }} onPressOut={() => { press.onPressOut(); squeeze(1); }}
    style={{ width: size, height: size, opacity: disabled ? 0.38 : 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
    {({ pressed }) => <Animated.View style={[{ width: disc, height: disc, borderRadius: disc / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: fill ?? (pressed && !destructive ? theme.hover : 'transparent'), transform: [{ scale }] },
      primary && large && { boxShadow: glow ? `0px 6px 22px ${theme.accent}8c` : `0px 4px 14px ${theme.accent}59` }]}>
      {busy ? <PlayerLoader color={color} size={glyph} /> : <Icon size={glyph} color={color} fill={primary ? color : 'none'} />}
    </Animated.View>}
  </Pressable>;
}
