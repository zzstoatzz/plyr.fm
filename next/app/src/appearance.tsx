import { createContext, useContext, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import type { PersonalPreferences } from './preference-space';

const light = { background: '#fbfbfd', surface: '#eceef4', text: '#141826', muted: '#50596b' };
const dark = { background: '#10131a', surface: '#202735', text: '#f4f6fa', muted: '#b7c2d5' };
const Appearance = createContext({ ...light, accent: '#244fa9', fontFamily: undefined as string | undefined, scale: 1, dark: false });

export function AppearanceProvider({ preferences, children }: { preferences: PersonalPreferences; children: ReactNode }) {
  const system = useColorScheme();
  const isDark = (preferences.theme === 'system' ? system : preferences.theme) === 'dark';
  const fontFamily = preferences.font === 'mono' ? Platform.select({ ios: 'Menlo', default: 'monospace' })
    : preferences.font === 'serif' ? Platform.select({ ios: 'Georgia', default: 'serif' }) : undefined;
  return <Appearance.Provider value={{
    ...(isDark ? dark : light), accent: preferences.accent, fontFamily, scale: preferences.scale, dark: isDark
  }}>{children}</Appearance.Provider>;
}

export const useAppearance = () => useContext(Appearance);
