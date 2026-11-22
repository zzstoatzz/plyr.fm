import { Text } from '../src/Text';
import { type Icon, ArrowLeft, House, MagnifyingGlass as Search, Books as Library, UserCircle as UserRound, PlusCircle as CirclePlus, Radio, ChartBar, GearSix as Settings, SignIn } from '../src/icons';
import { Link, Stack, router, usePathname, useSegments, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, View, StyleSheet } from 'react-native';
import { AppearanceProvider, useAppearance } from '../src/appearance';
import { restoreAuth, useAuth } from '../src/auth';
import { PlaybackProvider } from '../src/playback';
import { RadioPlayback, RadioProvider } from '../src/radio-session';
import { PlayerBar } from '../src/PlayerBar';
import { Toasts } from '../src/Toasts';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PreferencesProvider } from '../src/preference-context';
import { pageFrame } from '../src/controls';
import { Cover } from '../src/CatalogPieces';
import { useFinishPendingLike } from '../src/RowActions';
import { useMyAvatar } from '../src/use-my-avatar';
import { usePreferences } from '../src/preferences';
import { usesLiquidTabs } from '../src/tab-platform';
import { UploadQueueHost } from '../src/publishing/UploadQueue';
import { UploadIslandHost, useIslandHidesStatusBar } from '../src/publishing/UploadIsland';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlyrComic: require('../assets/fonts/ComicNeue-Regular.ttf'),
    PlyrComicBold: require('../assets/fonts/ComicNeue-Bold.ttf')
  });
  const auth = useAuth();
  const prefs = usePreferences(auth);
  useEffect(() => { void restoreAuth(); }, []);
  if (!fontsLoaded && !fontError) return null;
  return <GestureHandlerRootView style={{ flex: 1 }}><PreferencesProvider value={prefs}>
    <AppearanceProvider preferences={prefs.preferences}>
      <PlaybackProvider playThrough={prefs.preferences.playThrough} keepPlaying={prefs.preferences.keepPlaying} volume={prefs.preferences.volume}>
        <RadioProvider>
          <UploadQueueHost />
          <Shell />
          <UploadIslandHost />
        </RadioProvider>
      </PlaybackProvider>
    </AppearanceProvider>
  </PreferencesProvider></GestureHandlerRootView>;
}

function Shell() {
  const theme = useAppearance();
  const path = usePathname();
  const segments: readonly string[] = useSegments();
  const tab = segments[1];
  const auth = useAuth();
  const avatar = useMyAvatar(usesLiquidTabs ? null : auth.did);
  const islandOut = useIslandHidesStatusBar();
  useFinishPendingLike();
  const tabs: { label: string; href: Href; icon: Icon; active: boolean }[] = [
    { label: 'Home', href: '/(main)/(home)', icon: House, active: tab === '(home)' },
    { label: 'Search', href: '/(main)/(search)/search', icon: Search, active: tab === '(search)' },
    { label: 'Library', href: '/(main)/(library)/library', icon: Library, active: tab === '(library)' },
    ...(auth.did ? [{ label: 'Upload', href: '/(main)/(publish)/upload' as Href, icon: CirclePlus, active: tab === '(publish)' }] : []),
    { label: auth.did ? 'You' : 'Sign in', href: '/(main)/(you)/portal', icon: auth.did ? UserRound : SignIn, active: tab === '(you)' }
  ];
  const showBack = !['/', '/search', '/library', '/portal', '/oauth/callback'].includes(path) && !(tab === '(publish)' && path === '/upload');
  const detail = /^\/(track|u|album|playlist|edit-track)\//.test(path);
  const tabTitle = path === '/' ? 'plyr.fm' : path === '/search' ? 'search' : path === '/library' ? 'library' : path === '/portal' && auth.did ? 'you' : undefined;
  const detailTitle = path.startsWith('/u/') ? 'artist' : path.startsWith('/edit-track/') ? 'edit track'
    : path.startsWith('/album/') ? 'album' : path.startsWith('/playlist/') ? 'playlist' : 'track';
  const nav = !usesLiquidTabs && <SafeAreaView edges={['bottom']} role="navigation" accessibilityLabel="Main navigation" style={{
    flexDirection: 'row', paddingHorizontal: 8, width: '100%',
    backgroundColor: theme.surface,
    borderTopWidth: 1, borderColor: theme.line
  }}>
    {tabs.map(({ label, href, icon: Icon, active }) => <Link key={label} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} aria-current={active ? 'page' : undefined} accessibilityState={{ selected: active }}
        style={{ minHeight: 48, flex: 1, paddingHorizontal: 8, borderRadius: 12, gap: 2,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {label === 'You' && avatar ? <View style={{ borderRadius: 13, borderWidth: 1.5, borderColor: active ? theme.accent : 'transparent', padding: 1 }}><Cover uri={avatar} size={22} round instant /></View>
          : <Icon size={22} color={active ? theme.accent : theme.muted} weight={active ? 'fill' : 'regular'} />}
        <Text style={{ color: active ? theme.accent : theme.muted, fontSize: 10 * theme.scale, fontWeight: active ? '700' : '500', textTransform: 'lowercase' }}>{label}</Text>
      </Pressable>
    </Link>)}
  </SafeAreaView>;
  const dock = !usesLiquidTabs && <RadioPlayback><PlayerBar /></RadioPlayback>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
    <StatusBar style={theme.dark ? 'light' : 'dark'} hidden={islandOut} animated />
    <View testID="app-frame" style={{ flex: 1, width: '100%', overflow: 'hidden' }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Toasts />
        <View style={{
          ...pageFrame, minHeight: tabTitle ? 52 : 48, flexDirection: 'row', alignItems: 'center',
          borderBottomWidth: detail ? StyleSheet.hairlineWidth : 0, borderColor: theme.hairline
        }}>
          {showBack && <Pressable accessibilityRole="button" accessibilityLabel="Back"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            style={{ width: 44, minHeight: 44, justifyContent: 'center' }}><ArrowLeft color={theme.text} size={22} /></Pressable>}
          {tabTitle ? <Text accessibilityRole="header" aria-level={1} numberOfLines={1}
            style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 26 * theme.scale, fontWeight: '800', letterSpacing: -0.8, textTransform: 'lowercase' }}>{tabTitle}</Text>
            : detail ? <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: theme.muted, fontSize: 14 * theme.scale, fontWeight: '600', textTransform: 'lowercase' }}>{detailTitle}</Text>
            : <View style={{ flex: 1 }} />}
          {path === '/' && <Link href="/radio" asChild><Pressable accessibilityRole="link" accessibilityLabel="Radio"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={21} color={theme.muted} />
          </Pressable></Link>}
          {path === '/' && <Link href="/stats" asChild><Pressable accessibilityRole="link" accessibilityLabel="Stats"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <ChartBar size={21} color={theme.muted} />
          </Pressable></Link>}
          {path !== '/settings' && <Link href="/settings" asChild><Pressable accessibilityRole="link" accessibilityLabel="Settings"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={20} color={theme.muted} />
          </Pressable></Link>}
        </View>
        {/* Status bar visibility belongs to the screens (view-controller based), so the island hides it here. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background }, statusBarHidden: islandOut, statusBarAnimation: 'fade' }}>
          <Stack.Screen name="(main)" />
        </Stack>
        {dock}
        {nav}
      </View>
    </View>
  </SafeAreaView>;
}
