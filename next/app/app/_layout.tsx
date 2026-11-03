import { Link, Stack, router, usePathname, type Href } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, Text, View, useWindowDimensions, StyleSheet } from 'react-native';
import { AppearanceProvider, useAppearance } from '../src/appearance';
import { restoreAuth, useAuth } from '../src/auth';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import House from 'lucide-react-native/icons/house';
import Search from 'lucide-react-native/icons/search';
import Library from 'lucide-react-native/icons/library';
import UserRound from 'lucide-react-native/icons/user-round';
import Settings from 'lucide-react-native/icons/settings';
import { PlaybackProvider } from '../src/playback';
import { PlayerBar } from '../src/PlayerBar';
import { PreferencesProvider } from '../src/preference-context';
import { pageFrame } from '../src/controls';
import { usePreferences } from '../src/preferences';

export default function RootLayout() {
  const auth = useAuth();
  const prefs = usePreferences(auth);
  useEffect(() => { void restoreAuth(); }, []);
  return <PreferencesProvider value={prefs}>
    <AppearanceProvider preferences={prefs.preferences}>
      <PlaybackProvider playThrough={prefs.preferences.playThrough} keepPlaying={prefs.preferences.keepPlaying} volume={prefs.preferences.volume}>
        <Shell />
      </PlaybackProvider>
    </AppearanceProvider>
  </PreferencesProvider>;
}

function Shell() {
  const theme = useAppearance();
  const path = usePathname();
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
  const tabTitle = path === '/' ? (wide ? 'Home' : 'plyr.fm') : path === '/search' ? 'Search' : path === '/library' ? 'Library' : undefined;
  const detailTitle = path.startsWith('/u/') ? 'Artist' : path.startsWith('/edit-track/') ? 'Edit track'
    : path.startsWith('/album/') ? 'Album' : path.startsWith('/playlist/') ? 'Playlist' : 'Track';
  const nav = <View style={{
    flexDirection: wide ? 'column' : 'row', padding: 6, gap: 4, width: wide ? 172 : '100%',
    borderRightWidth: wide ? StyleSheet.hairlineWidth : 0, borderTopWidth: wide ? 0 : StyleSheet.hairlineWidth, borderColor: theme.surface
  }}>
    {wide && <Text style={{ color: theme.text, fontSize: 25, fontWeight: '900', margin: 12 }}>plyr.fm</Text>}
    {tabs.map(({ label, href, icon: Icon, active }) => <Link key={label} href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ selected: active }}
        style={{ minHeight: 48, flex: wide ? undefined : 1, paddingHorizontal: 8, borderRadius: 12, gap: wide ? 12 : 3,
          flexDirection: wide ? 'row' : 'column', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
          backgroundColor: active ? theme.surface : theme.background }}>
        <Icon size={21} color={active ? theme.text : theme.muted} strokeWidth={active ? 2.5 : 1.8} />
        <Text style={{ color: active ? theme.text : theme.muted, fontSize: wide ? 15 : 11, fontWeight: active ? '700' : '500' }}>{label}</Text>
      </Pressable>
    </Link>)}
  </View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <StatusBar style={theme.dark ? 'light' : 'dark'} />
    <View style={{ flex: 1, width: '100%', maxWidth: 996, alignSelf: 'center', flexDirection: wide ? 'row' : 'column' }}>
      {wide && nav}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{
          ...pageFrame, minHeight: tabTitle ? 66 : 48, flexDirection: 'row', alignItems: 'center',
          borderBottomWidth: detail ? StyleSheet.hairlineWidth : 0, borderColor: theme.surface
        }}>
          {showBack && <Pressable accessibilityRole="button" accessibilityLabel="Back"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            style={{ width: 44, minHeight: 44, justifyContent: 'center' }}><ArrowLeft color={theme.text} size={22} /></Pressable>}
          {tabTitle ? <Text accessibilityRole="header" numberOfLines={1}
            style={{ flex: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 30 * theme.scale, fontWeight: '800', letterSpacing: -0.8 }}>{tabTitle}</Text>
            : detail ? <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: theme.text, fontSize: 16 * theme.scale, fontWeight: '700' }}>{detailTitle}</Text>
            : <View style={{ flex: 1 }} />}
          {path !== '/settings' && <Link href="/settings" asChild><Pressable accessibilityRole="link" accessibilityLabel="Settings"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={20} color={theme.muted} />
          </Pressable></Link>}
        </View>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />
        <PlayerBar />
        {!wide && nav}
      </View>
    </View>
  </SafeAreaView>;
}
