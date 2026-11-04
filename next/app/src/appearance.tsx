import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { Platform, useColorScheme } from 'react-native';
import type { PersonalPreferences } from './preference-space';

const light = { background: '#fbfbfd', surface: '#eceef4', text: '#141826', muted: '#50596b' };
const dark = { background: '#10131a', surface: '#202735', text: '#f4f6fa', muted: '#b7c2d5' };
const Appearance = createContext({ ...light, accent: '#244fa9', fontFamily: undefined as string | undefined, scale: 1, dark: false });

export function AppearanceProvider({ preferences, children }: { preferences: PersonalPreferences; children: ReactNode }) {
  const system = useColorScheme();
  const pathname = usePathname();
  const isDark = (preferences.theme === 'system' ? system : preferences.theme) === 'dark';
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const embed = pathname.startsWith('/embed/');
    const background = embed ? 'transparent' : (isDark ? dark : light).background;
    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;
    document.documentElement.style.colorScheme = embed ? 'normal' : isDark ? 'dark' : 'light';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (embed) {
      meta?.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.append(meta);
    }
    meta.content = background;
  }, [isDark, pathname]);
  const fontFamily = preferences.font === 'mono' ? Platform.select({ ios: 'Menlo', default: 'monospace' })
    : preferences.font === 'serif' ? Platform.select({ ios: 'Georgia', default: 'serif' }) : undefined;
  return <Appearance.Provider value={{
    ...(isDark ? dark : light), accent: preferences.accent, fontFamily, scale: preferences.scale, dark: isDark
  }}>{children}</Appearance.Provider>;
}

export const useAppearance = () => useContext(Appearance);
