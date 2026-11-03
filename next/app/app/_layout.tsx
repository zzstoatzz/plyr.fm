import { Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { AppearanceProvider, useAppearance } from '../src/appearance';
import { restoreAuth, useAuth } from '../src/auth';
import { Action, row } from '../src/controls';
import { PlaybackProvider } from '../src/playback';
import { PlayerBar } from '../src/PlayerBar';
import { PreferencesProvider } from '../src/preference-context';
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
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <StatusBar style={theme.dark ? 'light' : 'dark'} />
    <View style={{ flex: 1, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      <View style={{ ...row, padding: 8, borderBottomWidth: 1, borderColor: theme.surface }}>
        <Text accessibilityRole="header" style={{ color: theme.text, fontWeight: '800', marginHorizontal: 8 }}>plyr.fm</Text>
        <Action label="Home" href="/" selected={path === '/'} />
        <Action label="Search" href="/search" selected={path === '/search'} />
        <Action label="Library" href="/library" selected={path === '/library'} />
        <Action label={auth.did ? 'Portal' : 'Sign in'} href={auth.did ? '/portal' : '/login'} />
        <Action label="Settings" href="/settings" selected={path === '/settings'} />
      </View>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />
      <PlayerBar />
    </View>
  </SafeAreaView>;
}
