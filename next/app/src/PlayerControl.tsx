import { usePressIntent } from './use-press-intent';
import type Play from 'lucide-react-native/icons/play';
import { ActivityIndicator, Pressable } from 'react-native';
import { useAppearance } from './appearance';

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy, destructive, disabled }: {
  icon: typeof Play; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean; destructive?: boolean; disabled?: boolean;
}) {
  const theme = useAppearance();
  const press = usePressIntent(onPress);
  const color = destructive ? theme.danger : primary ? theme.accent : theme.text;
  const size = large ? 64 : primary ? 48 : 44;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy || disabled }}
    disabled={busy || disabled} {...press}
    style={({ pressed }) => ({ width: size, height: size, opacity: disabled ? 0.4 : pressed && !destructive ? 0.6 : 1,
      transform: [{ scale: pressed && !theme.reduceMotion ? 0.94 : 1 }],
      alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' })}>
    {busy ? <ActivityIndicator accessibilityLabel="Loading playback" color={color} />
      : <Icon size={large ? 36 : primary ? 26 : 22} color={color} fill={primary ? color : 'none'} />}
  </Pressable>;
}
