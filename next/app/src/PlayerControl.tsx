import type Play from 'lucide-react-native/icons/play';
import { ActivityIndicator, Pressable } from 'react-native';
import { useAppearance } from './appearance';

function tint(surface: string, accent: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return surface;
  const channels = [1, 3, 5].map(start => {
    const base = Number.parseInt(surface.slice(start, start + 2), 16);
    const color = Number.parseInt(accent.slice(start, start + 2), 16);
    return Math.round(base + (color - base) * amount).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}

export function PlayerControl({ icon: Icon, label, onPress, primary, large, busy }: {
  icon: typeof Play; label: string; onPress: () => void; primary?: boolean; large?: boolean; busy?: boolean;
}) {
  const theme = useAppearance();
  const colors = {
    background: tint(theme.surface, theme.accent, 0.2),
    pressed: tint(theme.surface, theme.accent, 0.32),
    border: tint(theme.surface, theme.accent, 0.45)
  };
  const color = theme.text;
  const size = large ? 64 : primary ? 48 : 44;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }}
    disabled={busy} onPress={onPress}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2,
      transform: [{ scale: pressed ? 0.94 : 1 }],
      alignItems: 'center', justifyContent: 'center',
      borderWidth: primary ? 1 : 0, borderColor: colors.border,
      backgroundColor: primary ? pressed ? colors.pressed : colors.background
        : pressed ? theme.surface : 'transparent' })}>
    {busy ? <ActivityIndicator color={color} /> : <Icon size={large ? 30 : primary ? 25 : 22} color={color} />}
  </Pressable>;
}
