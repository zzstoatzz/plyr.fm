import { Text } from '../src/Text';
import { Link, Stack, router, usePathname, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform, Pressable, View, useWindowDimensions, StyleSheet } from 'react-native';
import { AppearanceProvider, useAppearance } from '../src/appearance';
import { restoreAuth, useAuth } from '../src/auth';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import House from 'lucide-react-native/icons/house';
import Search from 'lucide-react-native/icons/search';
import Library from 'lucide-react-native/icons/library';
import UserRound from 'lucide-react-native/icons/user-round';
import Radio from 'lucide-react-native/icons/radio';
import Settings from 'lucide-react-native/icons/settings';
import { PlaybackProvider } from '../src/playback';
import RadioPlayer, { RadioContext } from '../src/RadioPlayer';
import type { RadioStation } from '../src/radio';
import { KeyboardShortcuts } from '../src/KeyboardShortcuts';
import { PlayerBar } from '../src/PlayerBar';
import { NowPlayingOriginContext } from '../src/now-playing-origin';
import { PreferencesProvider } from '../src/preference-context';
import { pageFrame } from '../src/controls';
import { usePreferences } from '../src/preferences';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlyrComic: require('../assets/fonts/ComicNeue-Regular.ttf'),
    PlyrComicBold: require('../assets/fonts/ComicNeue-Bold.ttf')
  });
  const auth = useAuth();
  const prefs = usePreferences(auth);
  useEffect(() => { void restoreAuth(); }, []);
  if (!fontsLoaded && !fontError) return null;
  return <PreferencesProvider value={prefs}>
    <AppearanceProvider preferences={prefs.preferences}>
      <PlaybackProvider playThrough={prefs.preferences.playThrough} keepPlaying={prefs.preferences.keepPlaying} volume={prefs.preferences.volume}>
        <Shell />
      </PlaybackProvider>
    </AppearanceProvider>
  </PreferencesProvider>;
}

function Shell() {
  const [station, tune] = useState<RadioStation | null>(null);
  const [togglePlayback, setTogglePlayback] = useState<(() => void) | null>(null);
  const registerToggle = useCallback((toggle: (() => void) | null) => setTogglePlayback(() => toggle), []);
  const theme = useAppearance();
  const route = usePathname();
  const lastPage = useRef('/');
  if (route !== '/now-playing') lastPage.current = route;
  const path = route === '/now-playing' ? lastPage.current : route;
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= 800;
  if (path.startsWith('/embed/')) return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />;
  const accountPath = auth.did ? '/portal' : '/login';
  const tabs: { label: string; href: Href; icon: typeof House; active: boolean }[] = [
    { label: 'Home', href: '/', icon: House, active: path === '/' },
    { label: 'Search', href: '/search', icon: Search, active: path === '/search' },
    { label: 'Library', href: '/library', icon: Library, active: ['/library', '/liked', '/playlists'].includes(path) },
    { label: 'You', href: accountPath, icon: UserRound, active: ['/portal', '/login', '/settings', '/upload'].includes(path) }
  ];
  const showBack = !['/', '/search', '/library', '/portal', '/login'].includes(path);
  const detail = /^\/(track|u|album|playlist|edit-track)\//.test(path);
  const tabTitle = path === '/' ? (wide ? undefined : 'plyr.fm') : path === '/search' ? 'Search' : path === '/library' ? 'Library' : undefined;
  const detailTitle = path.startsWith('/u/') ? 'Artist' : path.startsWith('/edit-track/') ? 'Edit track'
    : path.startsWith('/album/') ? 'Album' : path.startsWith('/playlist/') ? 'Playlist' : 'Track';
  const nav = <View role="navigation" accessibilityLabel="Main navigation" style={{
    flexDirection: wide ? 'column' : 'row', padding: wide ? 12 : 6, gap: wide ? 8 : 4, width: wide ? 196 : '100%',
    borderRightWidth: wide ? StyleSheet.hairlineWidth : 0, borderTopWidth: wide ? 0 : StyleSheet.hairlineWidth, borderColor: theme.surface
  }}>
    {wide && <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="plyr.fm home" style={{ minHeight: 76, justifyContent: 'center', paddingHorizontal: 12 }}>
      <Text style={{ color: theme.text, fontSize: 29, fontWeight: '900', letterSpacing: -1 }}>plyr.fm</Text>
    </Pressable></Link>}
    {tabs.map(({ label, href, icon: Icon, active }) => <Link key={label} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} aria-current={active ? 'page' : undefined} accessibilityState={{ selected: active }}
        style={{ minHeight: 48, flex: wide ? undefined : 1, paddingHorizontal: wide ? 12 : 8, borderRadius: 12, gap: wide ? 12 : 3,
          flexDirection: wide ? 'row' : 'column', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
          backgroundColor: active ? theme.surface : theme.background }}>
        <Icon size={21} color={active ? theme.accent : theme.muted} strokeWidth={active ? 2.5 : 1.8} />
        <Text style={{ color: active ? theme.accent : theme.muted, fontSize: (wide ? 15 : 11) * theme.scale, fontWeight: active ? '700' : '500' }}>{label}</Text>
      </Pressable>
    </Link>)}
  </View>;
  return <RadioContext.Provider value={{ station, tune, togglePlayback, registerToggle }}><SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <KeyboardShortcuts origin={path} />
    <StatusBar style={theme.dark ? 'light' : 'dark'} />
    <View style={{ flex: 1, width: '100%', maxWidth: 1020, alignSelf: 'center', flexDirection: wide ? 'row' : 'column' }}>
      {wide && nav}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{
          ...pageFrame, minHeight: tabTitle ? 66 : 48, flexDirection: 'row', alignItems: 'center',
          borderBottomWidth: detail ? StyleSheet.hairlineWidth : 0, borderColor: theme.surface
        }}>
          {showBack && <Pressable accessibilityRole="button" accessibilityLabel="Back"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            style={{ width: 44, minHeight: 44, justifyContent: 'center' }}><ArrowLeft color={theme.text} size={22} /></Pressable>}
          {tabTitle ? <Text accessibilityRole="header" aria-level={1} numberOfLines={1}
            style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 30 * theme.scale, fontWeight: '800', letterSpacing: -0.8 }}>{tabTitle}</Text>
            : detail ? <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: theme.text, fontSize: 16 * theme.scale, fontWeight: '700' }}>{detailTitle}</Text>
            : <View style={{ flex: 1 }} />}
          {path === '/' && <Link href="/radio" asChild><Pressable accessibilityRole="link" accessibilityLabel="Radio"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={21} color={theme.muted} />
          </Pressable></Link>}
          {path !== '/settings' && <Link href="/settings" asChild><Pressable accessibilityRole="link" accessibilityLabel="Settings"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={20} color={theme.muted} />
          </Pressable></Link>}
        </View>
        <NowPlayingOriginContext.Provider value={path}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
            <Stack.Screen name="now-playing" options={{ presentation: Platform.OS === 'web' ? 'transparentModal' : 'card', animation: 'none', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
          </Stack>
        </NowPlayingOriginContext.Provider>
        {!wide && <View style={route === '/now-playing' ? { display: 'none' } : undefined}>{station ? <RadioPlayer key={station.slug} compact tuned={station} /> : <PlayerBar />}</View>}
        {!wide && nav}
      </View>
    </View>
    {wide && <View style={route === '/now-playing' ? { display: 'none' } : undefined}>{station ? <RadioPlayer key={station.slug} compact tuned={station} /> : <PlayerBar />}</View>}
  </SafeAreaView></RadioContext.Provider>;
}
