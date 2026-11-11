import { Platform, type ViewStyle } from 'react-native';
import type { useAppearance } from './appearance';

type Theme = ReturnType<typeof useAppearance>;

export function glassSurface(theme: Theme): ViewStyle {
  return {
    backgroundColor: Platform.OS === 'web' ? theme.glass : theme.surface,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
  };
}

export function cardSurface(theme: Theme): ViewStyle {
  return { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.cardBorder, borderRadius: 8 };
}

export function artworkShadow(theme: Theme) {
  return { boxShadow: theme.dark ? '0px 4px 12px #0000004d' : '0px 4px 12px #0000001f' };
}

export function accentGlow(accent: string): ViewStyle {
  return { boxShadow: `0px 0px 14px 3px ${accent}73` };
}
