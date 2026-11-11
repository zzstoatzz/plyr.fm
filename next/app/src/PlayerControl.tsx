import { usePressIntent } from './use-press-intent';
import type Play from 'lucide-react-native/icons/play';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAppearance } from './appearance';
import { accentGlow } from './materials';

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy, destructive, disabled, glow }: {
  icon: typeof Play; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean; destructive?: boolean; disabled?: boolean; glow?: boolean;
}) {
  const theme = useAppearance();
  const press = usePressIntent(onPress);
  const fill = primary ? large ? theme.accent : theme.text : undefined;
  const color = destructive ? theme.danger : primary ? large ? theme.onAccent : theme.background : theme.text;
  const size = large ? 64 : primary ? 48 : 44;
  const disc = large ? 64 : 40;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy || disabled }}
    disabled={busy || disabled} {...press}
    style={({ pressed }) => ({ width: size, height: size, opacity: disabled ? 0.4 : pressed && !destructive ? 0.6 : 1,
      transform: [{ scale: pressed && !theme.reduceMotion ? 0.94 : 1 }],
      alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' })}>
    <View style={[{ width: fill ? disc : size, height: fill ? disc : size, borderRadius: disc / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: fill },
      glow && large && accentGlow(theme.accent)]}>
      {busy ? <ActivityIndicator accessibilityLabel="Loading playback" color={color} />
        : <Icon size={large ? 30 : primary ? 20 : 22} color={color} fill={primary ? color : 'none'} />}
    </View>
  </Pressable>;
}
