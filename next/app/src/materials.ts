import { type ViewStyle } from 'react-native';
import type { useAppearance } from './appearance';

type Theme = ReturnType<typeof useAppearance>;

export function glassSurface(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.glassBorder,
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
