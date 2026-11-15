import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, useColorScheme } from 'react-native';
import type { PersonalPreferences } from './preference-sync';
import { onAccent, palettes, readableAccent } from '@plyr/next-core/colors';

const { light, dark } = palettes;
const Appearance = createContext({ ...light, accent: '#244fa9', onAccent: '#ffffff', fontFamily: undefined as string | undefined, scale: 1, dark: false, reduceMotion: true });

export function AppearanceProvider({ preferences, children }: { preferences: PersonalPreferences; children: ReactNode }) {
  const system = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduceMotion(value); }, () => undefined);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { live = false; listener.remove(); };
  }, []);
  const isDark = (preferences.theme === 'system' ? system : preferences.theme) === 'dark';
  const palette = isDark ? dark : light;
  const accent = useMemo(() => readableAccent(preferences.accent, [palette.background, palette.surface]), [preferences.accent, palette]);
  const fontFamily = preferences.font === 'comic-sans' ? 'PlyrComic' : preferences.font === 'mono' ? Platform.select({ ios: 'Menlo', default: 'monospace' })
    : preferences.font === 'serif' ? Platform.select({ ios: 'Georgia', default: 'serif' }) : undefined;
  return <Appearance.Provider value={{
    ...palette, accent, onAccent: onAccent(accent), fontFamily, scale: preferences.scale, dark: isDark, reduceMotion
  }}>{children}</Appearance.Provider>;
}

export const useAppearance = () => useContext(Appearance);
