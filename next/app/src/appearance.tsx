import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import type { PersonalPreferences } from './preference-sync';
import { onAccent, palettes, readableAccent } from './colors';

const { light, dark } = palettes;
const Appearance = createContext({ ...light, accent: '#244fa9', onAccent: '#ffffff', fontFamily: undefined as string | undefined, scale: 1, dark: false, reduceMotion: true });

export function AppearanceProvider({ preferences, children }: { preferences: PersonalPreferences; children: ReactNode }) {
  const system = useColorScheme();
  const pathname = usePathname();
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduceMotion(value); }, () => undefined);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { live = false; listener.remove(); };
  }, []);
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
  const palette = isDark ? dark : light;
  const accent = useMemo(() => readableAccent(preferences.accent, [palette.background, palette.surface]), [preferences.accent, palette]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; } * { scrollbar-width: thin; scrollbar-color: ${palette.border} transparent; }`;
    document.head.append(style);
    return () => style.remove();
  }, [accent, palette.border]);
  const fontFamily = preferences.font === 'comic-sans' ? 'PlyrComic' : preferences.font === 'mono' ? Platform.select({ ios: 'Menlo', default: 'monospace' })
    : preferences.font === 'serif' ? Platform.select({ ios: 'Georgia', default: 'serif' }) : undefined;
  return <Appearance.Provider value={{
    ...palette, accent, onAccent: onAccent(accent), fontFamily, scale: preferences.scale, dark: isDark, reduceMotion
  }}>{children}</Appearance.Provider>;
}

export const useAppearance = () => useContext(Appearance);
