import { Platform, type ViewStyle } from 'react-native';
import type { useAppearance } from './appearance';

type Theme = ReturnType<typeof useAppearance>;

export function contouredSurface(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.dark ? '#dce9ec24' : '#ffffffb3',
    boxShadow: theme.dark
      ? 'inset 1px 1px 1px #e0eaf314, inset -2px -1px 8px #00000055, 0px 12px 28px #00000026'
      : 'inset 1px 1px 1px #ffffffcc, inset -2px -1px 8px #55687a18, 0px 12px 28px #34445418',
    ...(Platform.OS === 'web' ? { backgroundImage: theme.dark
      ? 'linear-gradient(90deg, #ffffff03, transparent 4%, transparent 97%, #dbe7ef05)'
      : 'linear-gradient(90deg, #ffffff66, transparent 5%, transparent 97%, #ffffff80)' } : {}),
  };
}

export function dockSurface(theme: Theme): ViewStyle {
  return {
    ...contouredSurface(theme),
    backgroundColor: theme.surface,
    ...(Platform.OS === 'web' ? { backgroundImage: theme.dark
      ? 'linear-gradient(180deg, #ffffff08, transparent 40%, #0000000a)'
      : 'linear-gradient(180deg, #ffffffaa, #ffffff18)' } : {}),
  };
}
