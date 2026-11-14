import { Text } from '../src/Text';
import { type Icon, ArrowLeft, House, MagnifyingGlass as Search, Books as Library, UserCircle as UserRound, PlusCircle as CirclePlus, Radio, GearSix as Settings, ChartBar as ChartNoAxesColumn, Graph, SignIn } from '../src/icons';
import { Link, Stack, router, usePathname, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Animated, Platform, Pressable, View, useWindowDimensions, StyleSheet } from 'react-native';
import { AppearanceProvider, useAppearance } from '../src/appearance';
import { restoreAuth, useAuth } from '../src/auth';
import { PlaybackProvider } from '../src/playback';
import { RadioPlayback, RadioProvider } from '../src/radio-session';
import { KeyboardShortcuts } from '../src/KeyboardShortcuts';
import { PlayerBar } from '../src/PlayerBar';
import { Toasts } from '../src/Toasts';
import { NowPlayingOriginContext } from '../src/now-playing-origin';
import { PreferencesProvider } from '../src/preference-context';
import { pageFrame, wideFrame } from '../src/controls';
import { Cover } from '../src/CatalogPieces';
import { useFinishPendingLike } from '../src/RowActions';
import { useMyAvatar } from '../src/use-my-avatar';
import { DESKTOP_HOME_WIDTH } from '../src/DesktopHome';
import { usePreferences } from '../src/preferences';
import { UploadQueueHost } from '../src/publishing/UploadQueue';

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
        <RadioProvider>
          <UploadQueueHost />
          <Shell />
        </RadioProvider>
      </PlaybackProvider>
    </AppearanceProvider>
  </PreferencesProvider>;
}

function Shell() {
  const theme = useAppearance();
  const route = usePathname();
  const lastPage = useRef('/');
  if (route !== '/now-playing') lastPage.current = route;
  const path = route === '/now-playing' ? lastPage.current : route;
  const auth = useAuth();
  const avatar = useMyAvatar(auth.did);
  useFinishPendingLike();
  const { width } = useWindowDimensions();
  const wide = width >= 800;
  if (path.startsWith('/embed/')) return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />;
  const accountPath = auth.did ? '/portal' : '/login';
  const tabs: { label: string; href: Href; icon: Icon; active: boolean }[] = [
    { label: 'Home', href: '/', icon: House, active: path === '/' },
    { label: 'Search', href: '/search', icon: Search, active: path === '/search' },
    { label: 'Library', href: '/library', icon: Library, active: ['/library', '/liked', '/playlists'].includes(path) },
    ...(auth.did ? [{ label: 'Upload', href: '/upload' as Href, icon: CirclePlus, active: path === '/upload' }] : []),
    { label: auth.did ? 'You' : 'Sign in', href: accountPath, icon: auth.did ? UserRound : SignIn, active: ['/portal', '/login'].includes(path) || !auth.did && path === '/upload' || !wide && path === '/settings' }
  ];
  // the sidebar is the way out of its own destinations on a wide window
  const showBack = !['/', '/search', '/library', '/portal', '/login', '/upload'].includes(path) && !(wide && ['/radio', '/atlas', '/stats', '/settings'].includes(path));
  const detail = /^\/(track|u|album|playlist|edit-track)\//.test(path);
  const tabTitle = path === '/' ? (wide ? undefined : 'plyr.fm') : path === '/search' ? 'search' : path === '/library' ? 'library' : path === '/portal' ? 'your music' : path === '/atlas' ? 'atlas' : undefined;
  const detailTitle = path.startsWith('/u/') ? 'artist' : path.startsWith('/edit-track/') ? 'edit track'
    : path.startsWith('/album/') ? 'album' : path.startsWith('/playlist/') ? 'playlist' : 'track';
  const nav = <View role="navigation" accessibilityLabel="Main navigation" style={{
    flexDirection: wide ? 'column' : 'row', padding: wide ? 14 : 0, paddingHorizontal: wide ? 14 : 8, gap: wide ? 4 : 0, width: wide ? 216 : '100%',
    backgroundColor: theme.surface,
    borderRightWidth: wide ? 1 : 0, borderTopWidth: wide ? 0 : 1, borderColor: wide ? theme.hairline : theme.line
  }}>
    {wide && <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="plyr.fm home" style={{ minHeight: 64, justifyContent: 'center', paddingHorizontal: 12 }}>
      <Text style={{ color: theme.text, fontSize: 29, fontWeight: '900', letterSpacing: -1 }}>plyr.fm</Text>
    </Pressable></Link>}
    {tabs.map(({ label, href, icon: Icon, active }) => <Link key={label} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} aria-current={active ? 'page' : undefined} accessibilityState={{ selected: active }}
        style={{ minHeight: 48, flex: wide ? undefined : 1, paddingHorizontal: wide ? 12 : 8, borderRadius: 12, gap: wide ? 12 : 2,
          flexDirection: wide ? 'row' : 'column', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
          backgroundColor: active && wide ? theme.hover : 'transparent' }}>
        {label === 'You' && avatar ? <View style={{ borderRadius: 13, borderWidth: 1.5, borderColor: active ? wide ? theme.text : theme.accent : 'transparent', padding: 1 }}><Cover uri={avatar} size={22} round instant /></View>
          : <Icon size={22} color={active ? wide ? theme.text : theme.accent : theme.muted} weight={active ? 'fill' : 'regular'} />}
        <Text style={{ color: active ? wide ? theme.text : theme.accent : theme.muted, fontSize: (wide ? 15.5 : 10) * theme.scale, fontWeight: active ? '700' : '500', textTransform: 'lowercase' }}>{label}</Text>
      </Pressable>
    </Link>)}
    {wide && <View style={{ flex: 1, minHeight: 24 }} />}
    {wide && ([
      { label: 'Radio', href: '/radio', icon: Radio },
      { label: 'Atlas', href: '/atlas', icon: Graph },
      { label: 'Stats', href: '/stats', icon: ChartNoAxesColumn },
      { label: 'Settings', href: '/settings', icon: Settings },
    ] as const).map(({ label, href, icon: Icon }) => <Link key={label} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} aria-current={path === href ? 'page' : undefined}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: path === href ? theme.hover : 'transparent' }}>
        <Icon size={20} color={path === href ? theme.text : theme.faint} weight={path === href ? 'fill' : 'regular'} />
        <Text style={{ color: path === href ? theme.text : theme.faint, fontSize: 14 * theme.scale, fontWeight: path === href ? '600' : '400', textTransform: 'lowercase' }}>{label}</Text>
      </Pressable>
    </Link>)}
  </View>;
  const dock = <RadioPlayback><PlayerBar /></RadioPlayback>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <RadioPlayback><KeyboardShortcuts origin={path} /></RadioPlayback>
    <StatusBar style={theme.dark ? 'light' : 'dark'} />
    <View testID="app-frame" style={{ flex: 1, width: '100%', flexDirection: wide ? 'row' : 'column', overflow: 'hidden' }}>
      {wide && nav}
      <View style={{ flex: 1, minWidth: 0 }}>
        {!wide && <Toasts top />}
        {!(wide && path === '/') && <View style={{
          ...(path === '/atlas' ? { ...pageFrame, maxWidth: '100%' } : width >= DESKTOP_HOME_WIDTH && ['/library', '/liked'].includes(path) ? wideFrame : pageFrame), minHeight: tabTitle ? 52 : 48, flexDirection: 'row', alignItems: 'center',
          borderBottomWidth: detail ? StyleSheet.hairlineWidth : 0, borderColor: theme.hairline
        }}>
          {showBack && <Pressable accessibilityRole="button" accessibilityLabel="Back"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            style={{ width: 44, minHeight: 44, justifyContent: 'center' }}><ArrowLeft color={theme.text} size={22} /></Pressable>}
          {tabTitle ? <Text accessibilityRole="header" aria-level={1} numberOfLines={1}
            style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 26 * theme.scale, fontWeight: '800', letterSpacing: -0.8, textTransform: 'lowercase' }}>{tabTitle}</Text>
            : detail ? <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: theme.muted, fontSize: 14 * theme.scale, fontWeight: '600', textTransform: 'lowercase' }}>{detailTitle}</Text>
            : <View style={{ flex: 1 }} />}
          {!wide && path === '/' && <Link href="/radio" asChild><Pressable accessibilityRole="link" accessibilityLabel="Radio"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={21} color={theme.muted} />
          </Pressable></Link>}
          {!wide && path !== '/settings' && <Link href="/settings" asChild><Pressable accessibilityRole="link" accessibilityLabel="Settings"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={20} color={theme.muted} />
          </Pressable></Link>}
        </View>}
        <NowPlayingOriginContext.Provider value={path}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
            <Stack.Screen name="now-playing" options={{ presentation: Platform.OS === 'web' ? 'transparentModal' : 'card', animation: 'none', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
          </Stack>
        </NowPlayingOriginContext.Provider>
        {!wide && <Animated.View aria-hidden={route === '/now-playing'} pointerEvents={route === '/now-playing' ? 'none' : 'auto'}>{dock}</Animated.View>}
        {!wide && nav}
      </View>
    </View>
    {wide && <Toasts />}
    {wide && <View aria-hidden={route === '/now-playing'} pointerEvents={route === '/now-playing' ? 'none' : 'auto'}>{dock}</View>}
  </SafeAreaView>;
}
